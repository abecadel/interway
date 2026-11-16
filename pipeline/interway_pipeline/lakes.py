"""Synthetic routable edges across lakes and reservoirs.

Lakes are mapped as polygons without centre lines, so waterways that enter a lake end at its shore,
and chains of lakes (Mazury!) are separate polygons that merely touch. We therefore:

1. merge lake polygons that touch or nearly touch into one *water body*,
2. keep water bodies touched by the navigable network or containing an allowlisted lake,
3. triangulate each water body (constrained Delaunay) and build a navigation mesh: nodes at the midpoints
   of internal triangle edges, connected within each triangle. This stays inside the water and follows
   narrow passages between lakes,
4. connect each entry point (waterway end, marina) to the mesh triangle it lies in, plus direct
   straight lines between entry points when the line stays on water.
"""
from __future__ import annotations

import logging
from collections import defaultdict

import shapely
from shapely import STRtree, prepared
from shapely.geometry import LineString, MultiPolygon, Point, Polygon
from shapely.ops import unary_union

from .extract import Lake
from .model import LonLat, Segment, haversine, metres_to_deg
from .topology import new_node_id, node_positions

log = logging.getLogger(__name__)

ENTRY_TOLERANCE_M = 60.0
MERGE_GAP_M = 25.0
MAX_DIRECT_ENTRIES = 40


def _clusters(polys: list[Polygon | MultiPolygon], gap_deg: float) -> list[list[int]]:
    tree = STRtree(polys)
    parent = list(range(len(polys)))

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, p in enumerate(polys):
        for j in tree.query(p, predicate="dwithin", distance=gap_deg):
            ri, rj = find(i), find(int(j))
            if ri != rj:
                parent[ri] = rj
    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(len(polys)):
        groups[find(i)].append(i)
    return list(groups.values())


def water_bodies(lakes: list[Lake]) -> list[tuple[Polygon | MultiPolygon, list[Lake]]]:
    gap = metres_to_deg(MERGE_GAP_M)
    out = []
    for group in _clusters([lk.polygon for lk in lakes], gap):
        members = [lakes[i] for i in group]
        if len(members) == 1:
            out.append((members[0].polygon, members))
        else:
            # close the small gaps between touching lakes, then shrink back
            body = unary_union([m.polygon.buffer(gap, 2) for m in members]).buffer(-gap, 2)
            body = body if not body.is_empty else unary_union([m.polygon for m in members])
            out.append((body, members))
    return out


def connect_lakes(segments: list[Segment], lakes: list[Lake], marinas: list[tuple[str, LonLat]]) -> list[Segment]:
    if not lakes:
        return []
    pos = node_positions(segments)
    ids = list(pos)
    tree = STRtree([Point(pos[n]) for n in ids]) if ids else None
    marina_tree = STRtree([Point(p) for _, p in marinas]) if marinas else None
    tol = metres_to_deg(ENTRY_TOLERANCE_M)
    added: list[Segment] = []
    used = 0
    bodies = water_bodies(lakes)
    for body, members in bodies:
        zone = body.buffer(tol)
        entries: list[tuple[int, LonLat]] = []
        if tree is not None:
            entries = [(ids[i], pos[ids[i]]) for i in tree.query(zone, predicate="intersects")]
        allowlisted = any(m.allowlisted for m in members)
        if not entries and not allowlisted:
            continue
        if marina_tree is not None:
            for i in marina_tree.query(body, predicate="intersects"):
                entries.append((new_node_id(), marinas[i][1]))
        used += 1
        added.extend(_mesh(body, members, entries))
    log.info("lakes: %d water bodies from %d lakes, %d connected, %d synthetic segments",
             len(bodies), len(lakes), used, len(added))
    return added


def _lake_namer(members: list[Lake]):
    if len(members) == 1:
        name = members[0].name
        return lambda _p: name
    tree = STRtree([m.polygon for m in members])

    def name_at(p: LonLat) -> str:
        hits = tree.query(Point(p), predicate="intersects")
        if len(hits):
            return members[int(hits[0])].name
        return members[int(tree.nearest(Point(p)))].name
    return name_at


def _mesh(body: Polygon | MultiPolygon, members: list[Lake], entries: list[tuple[int, LonLat]]) -> list[Segment]:
    segs: list[Segment] = []
    if body.is_empty:
        return segs
    name_at = _lake_namer(members)

    def add(a: int, b: int, pa: LonLat, pb: LonLat):
        if a != b and pa != pb:
            mid = ((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)
            segs.append(Segment(a=a, b=b, coords=[pa, pb], name=name_at(mid), kind="lake"))

    minx, miny, maxx, maxy = body.bounds
    diag_m = haversine((minx, miny), (maxx, maxy))
    step = metres_to_deg(min(1500.0, max(150.0, diag_m / 40)))
    shape = body.simplify(metres_to_deg(10.0), preserve_topology=True)
    shape = shapely.segmentize(shape, step)
    tris = list(shapely.constrained_delaunay_triangles(shape).geoms)

    # Node per internal edge (shared by two triangles), keyed by its sorted vertex pair.
    edge_tris: dict[tuple, list[int]] = defaultdict(list)
    tri_edges: list[list[tuple]] = []
    for t, tri in enumerate(tris):
        c = list(tri.exterior.coords)[:3]
        keys = [tuple(sorted((c[i], c[(i + 1) % 3]))) for i in range(3)]
        tri_edges.append(keys)
        for k in keys:
            edge_tris[k].append(t)
    mid_node: dict[tuple, tuple[int, LonLat]] = {}
    for k, ts in edge_tris.items():
        if len(ts) == 2:
            (x1, y1), (x2, y2) = k
            mid_node[k] = (new_node_id(), ((x1 + x2) / 2, (y1 + y2) / 2))
    for keys in tri_edges:
        inner = [mid_node[k] for k in keys if k in mid_node]
        for i in range(len(inner)):
            for j in range(i + 1, len(inner)):
                add(inner[i][0], inner[j][0], inner[i][1], inner[j][1])

    # Entries -> mesh nodes of the triangle they are in (or the nearest one).
    ttree = STRtree(tris)
    for nid, p in entries:
        pt = Point(p)
        hits = ttree.query(pt, predicate="intersects")
        t = int(hits[0]) if len(hits) else int(ttree.nearest(pt))
        # a lake that is a single triangle has no inner edges: entries are linked by the direct lines below
        for mid, q in (mid_node[k] for k in tri_edges[t] if k in mid_node):
            add(nid, mid, p, q)

    # Direct straight lines between entries where they stay on water (nicer, shorter routes).
    if 1 < len(entries) <= MAX_DIRECT_ENTRIES:
        water = prepared.prep(body.buffer(metres_to_deg(ENTRY_TOLERANCE_M)))
        for i in range(len(entries)):
            for j in range(i + 1, len(entries)):
                (a, pa), (b, pb) = entries[i], entries[j]
                if pa != pb and water.contains(LineString([pa, pb])):
                    add(a, b, pa, pb)
    return segs
