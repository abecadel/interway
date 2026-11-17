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

import heapq
import logging
from collections import Counter, defaultdict
from dataclasses import replace

import shapely
from shapely import STRtree, prepared
from shapely.geometry import LineString, MultiPoint, MultiPolygon, Point, Polygon
from shapely.ops import unary_union

from .extract import Lake
from .model import LonLat, Segment, haversine, metres_to_deg
from .topology import new_node_id, node_positions

log = logging.getLogger(__name__)

ENTRY_TOLERANCE_M = 60.0
MERGE_GAP_M = 25.0
MAX_DIRECT_ENTRIES = 40
NEAREST_TARGETS = 8


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
    degree: Counter[int] = Counter()
    for s in segments:
        degree[s.a] += 1
        degree[s.b] += 1
    dead_ends = {n for n, d in degree.items() if d == 1}
    touching: dict[int, list[Segment]] = defaultdict(list)
    for s in segments:
        touching[s.a].append(s)
        touching[s.b].append(s)
    added: list[Segment] = []
    used = 0
    # Lakes are crossed among themselves; river/canal areas (with the lakes they touch) only bridge dead ends,
    # meshed within a window around each dead end so whole-river water areas are never triangulated.
    lake_bodies = water_bodies([lk for lk in lakes if lk.kind == "lake"] + _straits(lakes))
    channel_bodies = _channel_windows(lakes, [pos[n] for n in dead_ends])
    bodies = lake_bodies + channel_bodies
    for body, members in bodies:
        zone = body.buffer(tol)
        entries: list[tuple[int, LonLat]] = []
        if tree is not None:
            inside = prepared.prep(body)
            entries = [(ids[i], pos[ids[i]]) for i in tree.query(zone, predicate="intersects")
                       if _enters(ids[i], touching[ids[i]], inside, dead_ends)]
        # A body made only of river/canal areas is not a lake to cross: it only bridges places where a
        # waterway line stops (dead ends), and its mesh links those to the rest instead of replacing the line.
        bridge = None
        if any(m.kind == "channel" for m in members):
            bridge = {n for n, _ in entries if n in dead_ends}
            if not bridge:
                continue
        elif not entries and not any(m.allowlisted for m in members):
            continue
        if marina_tree is not None and bridge is None:
            for i in marina_tree.query(body, predicate="intersects"):
                entries.append((new_node_id(), marinas[i][1]))
        used += 1
        added.extend(_mesh(body, members, entries, bridge))
    log.info("lakes: %d water bodies from %d lakes, %d connected, %d synthetic segments",
             len(bodies), len(lakes), used, len(added))
    return added


BRIDGE_WINDOW_M = 5000.0
STRAIT_MAX_M = 3000.0


def _straits(lakes: list[Lake]) -> list[Lake]:
    """Short river/canal areas joining two or more lakes (Kanał Kula between Jagodne and Boczne).

    They are mapped only as water areas, without a waterway line, so they are crossed like part of the lakes.
    """
    real = [lk.polygon for lk in lakes if lk.kind == "lake"]
    if not real:
        return []
    tree = STRtree(real)
    gap = metres_to_deg(MERGE_GAP_M)
    out = []
    for lk in lakes:
        if lk.kind != "channel":
            continue
        minx, miny, maxx, maxy = lk.polygon.bounds
        if haversine((minx, miny), (maxx, maxy)) > STRAIT_MAX_M:
            continue
        if len(tree.query(lk.polygon, predicate="dwithin", distance=gap)) >= 2:
            out.append(replace(lk, kind="lake"))
    return out


def _channel_windows(lakes: list[Lake], dead_end_pos: list[LonLat]) -> list[tuple[Polygon | MultiPolygon, list[Lake]]]:
    """Water bodies for bridging: river/canal areas (and lakes they touch) clipped to windows around dead ends."""
    channels = [lk for lk in lakes if lk.kind == "channel"]
    if not channels or not dead_end_pos:
        return []
    tol = metres_to_deg(ENTRY_TOLERANCE_M)
    channel_tree = STRtree([c.polygon for c in channels])
    near = [p for p in dead_end_pos if len(channel_tree.query(Point(p), predicate="dwithin", distance=tol))]
    if not near:
        return []
    windows = unary_union([Point(p).buffer(metres_to_deg(BRIDGE_WINDOW_M), 8) for p in near])
    all_tree = STRtree([lk.polygon for lk in lakes])
    out = []
    for window in getattr(windows, "geoms", [windows]):
        clipped = []
        for i in all_tree.query(window, predicate="intersects"):
            lk = lakes[int(i)]
            piece = lk.polygon.intersection(window)
            if piece.area > 0:  # pieces touching the window only at a point or line are no water
                clipped.append(replace(lk, polygon=piece))
        out += [b for b in water_bodies(clipped) if any(m.kind == "channel" for m in b[1])]
    return out


def _enters(node: int, segs: list[Segment], inside, dead_ends: set[int]) -> bool:
    """A node is a way into the water only where its waterway ends there or continues into the water.

    A canal that merely runs along a reservoir's shore must not be connected through the reservoir.
    """
    if node in dead_ends:
        return True
    for s in segs:
        if len(s.coords) == 2:
            nxt = ((s.coords[0][0] + s.coords[1][0]) / 2, (s.coords[0][1] + s.coords[1][1]) / 2)
        else:
            nxt = s.coords[1] if s.a == node else s.coords[-2]
        if inside.contains(Point(nxt)):
            return True
    return False


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


def _mesh(body: Polygon | MultiPolygon, members: list[Lake], entries: list[tuple[int, LonLat]],
          bridge: set[int] | None = None) -> list[Segment]:
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
    water = prepared.prep(body.buffer(metres_to_deg(ENTRY_TOLERANCE_M)))
    if 1 < len(entries) <= MAX_DIRECT_ENTRIES:
        for i in range(len(entries)):
            for j in range(i + 1, len(entries)):
                (a, pa), (b, pb) = entries[i], entries[j]
                if pa != pb and water.contains(LineString([pa, pb])):
                    add(a, b, pa, pb)
    return prune_and_smooth(segs, {nid for nid, _ in entries}, water, bridge)


def prune_and_smooth(segs: list[Segment], entries: set[int], water, bridge: set[int] | None = None) -> list[Segment]:
    """Keep only mesh edges on shortest paths between entries, then straighten each chain.

    The full mesh is large (thousands of edges for a big lake) and zig-zags between triangle midpoints.
    Routes only ever run between entries, so the union of entry-to-entry shortest paths is all the
    router needs. Each chain between junctions becomes one segment whose points are reduced greedily to
    the farthest point still in line of sight over water.
    """
    adj: dict[int, list[tuple[int, int]]] = defaultdict(list)
    for i, sg in enumerate(segs):
        adj[sg.a].append((sg.b, i))
        adj[sg.b].append((sg.a, i))
    keep: set[int] = set()
    targets = [e for e in entries if e in adj]
    lengths = [sg.length for sg in segs]
    pos = {sg.a: sg.coords[0] for sg in segs} | {sg.b: sg.coords[-1] for sg in segs}
    wanted = _target_pairs(targets, pos)
    if bridge is not None:
        # only paths that start or end at a dead end, plus links among the dead ends themselves
        ends = [t for t in targets if t in bridge]
        among = _target_pairs(ends, pos)
        wanted = {t: {o for o in w if t in bridge or o in bridge} | among.get(t, set()) for t, w in wanted.items()}
    for src in targets:
        remaining = set(wanted[src])
        dist = {src: 0.0}
        prev: dict[int, int] = {}
        heap = [(0.0, src)]
        while heap and remaining:
            d, u = heapq.heappop(heap)
            if d > dist[u]:
                continue
            remaining.discard(u)
            for v, i in adj[u]:
                nd = d + lengths[i]
                if nd < dist.get(v, float("inf")):
                    dist[v] = nd
                    prev[v] = i
                    heapq.heappush(heap, (nd, v))
        tree: set[int] = set()  # edges of this source's shortest-path tree already walked
        for dst in wanted[src]:
            node = dst
            while node in prev and prev[node] not in tree:
                i = prev[node]
                tree.add(i)
                node = segs[i].a if segs[i].b == node else segs[i].b
        keep |= tree
    kept = [segs[i] for i in sorted(keep)]
    return _chains(kept, entries, water, "lake" if bridge is None else "bridge")


def _target_pairs(targets: list[int], pos: dict[int, LonLat]) -> dict[int, set[int]]:
    """Which entries each entry needs a path to.

    Small lakes: all of them. Big water bodies (IJsselmeer, a river area with thousands of entries) link
    each entry to its Delaunay neighbours: that graph contains every entry's nearest neighbour and the
    minimum spanning tree, so the result stays connected, and it has O(n) edges instead of all n² pairs.
    """
    if len(targets) <= NEAREST_TARGETS + 1:
        return {t: set(targets) - {t} for t in targets}
    wanted: dict[int, set[int]] = {t: set() for t in targets}
    by_pos: dict[LonLat, list[int]] = defaultdict(list)
    for t in targets:
        by_pos[pos[t]].append(t)

    def link(xs: list[int], ys: list[int]) -> None:
        for x in xs:
            for y in ys:
                if x != y:
                    wanted[x].add(y)
                    wanted[y].add(x)

    for same in by_pos.values():  # entries at the same spot (several waterways meeting at the shore)
        link(same, same)
    edges = shapely.delaunay_triangles(MultiPoint(list(by_pos)), only_edges=True)
    for line in getattr(edges, "geoms", []):
        p, q = line.coords
        link(by_pos[tuple(p)], by_pos[tuple(q)])
    return wanted


def _chains(segs: list[Segment], entries: set[int], water, kind: str = "lake") -> list[Segment]:
    """Merge runs of degree-2 mesh nodes into single straightened segments."""
    adj: dict[int, list[int]] = defaultdict(list)
    for i, sg in enumerate(segs):
        adj[sg.a].append(i)
        adj[sg.b].append(i)
    stop = {n for n, es in adj.items() if len(es) != 2 or n in entries}
    used: set[int] = set()
    out: list[Segment] = []

    def walk(start: int, first: int) -> None:
        pts, names, node, i = [], [], start, first
        pts.append(segs[i].coords[0] if segs[i].a == node else segs[i].coords[-1])
        while True:
            used.add(i)
            sg = segs[i]
            node = sg.b if sg.a == node else sg.a
            pts.append(sg.coords[-1] if sg.b == node else sg.coords[0])
            names.append(sg.name)
            if node in stop:
                break
            i = next(j for j in adj[node] if j != i)
        out.append(Segment(a=start, b=node, coords=_straighten(pts, water), name=names[len(names) // 2], kind=kind))

    for n in stop:
        for i in adj[n]:
            if i not in used:
                walk(n, i)
    # Every kept edge lies on a path between entries, so every chain reaches a stop node: no closed loops.
    return out


def _straighten(pts: list[LonLat], water) -> list[LonLat]:
    out = [pts[0]]
    i = 0
    while i < len(pts) - 1:
        j = len(pts) - 1
        while j > i + 1 and not water.contains(LineString([pts[i], pts[j]])):
            j -= 1
        out.append(pts[j])
        i = j
    return out
