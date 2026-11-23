"""Synthetic routable edges across lakes and reservoirs.

Lakes are mapped as polygons without centre lines, so waterways that enter a lake end at its shore,
and chains of lakes (Mazury!) are separate polygons that merely touch. We therefore:

1. merge lake polygons that touch or nearly touch into one *water body*,
2. keep water bodies touched by the navigable network or containing an allowlisted lake,
3. triangulate each water body (constrained Delaunay) and build a navigation mesh: nodes at the midpoints
   of internal triangle edges, connected within each triangle. This stays inside the water and follows
   narrow passages between lakes,
4. connect each entry point (waterway end, marina) to the mesh triangle it lies in, plus direct
   straight lines between entry points when the line stays on water,
5. for big lakes (the Great Lakes, Vänern), add an open-water grid like the sea mesh: the mesh of step 3 keeps
   only paths between neighbouring entries, which zigzag from harbour to harbour across a big lake.
"""
from __future__ import annotations

import heapq
import logging
from collections import Counter, defaultdict
from collections.abc import Sequence
from dataclasses import replace

import numpy as np
import shapely
from shapely import STRtree, prepared
from shapely.geometry import LineString, MultiPoint, MultiPolygon, Point, Polygon
from shapely.ops import unary_union

from .extract import Lake
from .model import LonLat, Segment, area_km2, haversine, metres_to_deg
from .sea import _grid_moves, from_merc, to_merc
from .topology import new_node_id, node_positions

log = logging.getLogger(__name__)

ENTRY_TOLERANCE_M = 60.0
MERGE_GAP_M = 25.0
MAX_DIRECT_ENTRIES = 40
NEAREST_TARGETS = 8


LOCK_SIDE_M = 10.0  # a lock's dead end opens on a water area no more than this farther from it than the other end
CHAMBER_MAX_M = 1000.0  # a water area holding both ends of a lock and no bigger than this is the lock chamber


def _span(poly: Polygon | MultiPolygon) -> float:
    minx, miny, maxx, maxy = poly.bounds
    return haversine((minx, miny), (maxx, maxy))


def _apart(polys: list[Polygon | MultiPolygon], tree: STRtree, locks: Sequence[tuple[LonLat, LonLat]],
           tol: float) -> set[tuple[int, int]]:
    """Pairs of water areas a lock runs between: one end nearer each (Hjellevannet above Skien lock and
    Bryggevannet below it touch at the dam). They lie at different levels and are never one body. The
    chamber's own area (water=lock, holding both ends) is kept apart from all of them: it touches both."""
    out: set[tuple[int, int]] = set()
    for a, b in locks:
        pa, pb = Point(a), Point(b)
        near = [int(i) for i in tree.query(LineString([a, b]), predicate="dwithin", distance=tol)]
        d = {i: (polys[i].distance(pa), polys[i].distance(pb)) for i in near}
        chamber = {i for i in near if max(d[i]) == 0 and _span(polys[i]) <= CHAMBER_MAX_M}
        for i in near:
            for j in near:
                if i < j:
                    (ai, bi), (aj, bj) = d[i], d[j]
                    if (ai < aj and bj < bi) or (aj < ai and bi < bj) or i in chamber or j in chamber:
                        out.add((i, j))
    return out


def _clusters(polys: list[Polygon | MultiPolygon], gap_deg: float,
              locks: Sequence[tuple[LonLat, LonLat]] = ()) -> list[list[int]]:
    tree = STRtree(polys)
    parent = list(range(len(polys)))
    apart = _apart(polys, tree, locks, metres_to_deg(ENTRY_TOLERANCE_M)) if locks else set()

    def find(x: int) -> int:
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i, p in enumerate(polys):
        for j in tree.query(p, predicate="dwithin", distance=gap_deg):
            if (min(i, int(j)), max(i, int(j))) in apart:
                continue
            ri, rj = find(i), find(int(j))
            if ri != rj:
                parent[ri] = rj
    groups: dict[int, list[int]] = defaultdict(list)
    for i in range(len(polys)):
        groups[find(i)].append(i)
    return list(groups.values())


def water_bodies(lakes: list[Lake],
                 locks: Sequence[tuple[LonLat, LonLat]] = ()) -> list[tuple[Polygon | MultiPolygon, list[Lake]]]:
    gap = metres_to_deg(MERGE_GAP_M)
    out = []
    for group in _clusters([lk.polygon for lk in lakes], gap, locks):
        members = [lakes[i] for i in group]
        if len(members) == 1:
            out.append((members[0].polygon, members))
        else:
            # close the small gaps between touching lakes, then shrink back
            body = unary_union([m.polygon.buffer(gap, 2) for m in members]).buffer(-gap, 2)
            body = body if not body.is_empty else unary_union([m.polygon for m in members])
            out.append((body, members))
    return out


def connect_lakes(segments: list[Segment], lakes: list[Lake], marinas: list[tuple[str, LonLat]],
                  weirs: list = ()) -> list[Segment]:
    """Synthetic segments across lakes and through river/canal areas. No mesh edge crosses a weir or dam (the
    Liffey's weirs keep a route from running up the river from Dublin to the Grand Canal)."""
    if not lakes:
        return []
    # a weir mapped as a point sits on the river's centre line: it closes a river area of ordinary width
    weir_tree = STRtree([w.buffer(metres_to_deg(WEIR_POINT_M if w.geom_type == "Point" else WEIR_M))
                         for w in weirs]) if weirs else None
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
    locks = [(pos[s.a], pos[s.b]) for s in segments if s.lock and s.a != s.b]
    lake_bodies = water_bodies([lk for lk in lakes if lk.kind == "lake"] + _straits(lakes), locks)
    channel_bodies = _channel_windows(lakes, [pos[n] for n in dead_ends], locks)
    bodies = lake_bodies + channel_bodies
    # dwithin, not a buffered zone: buffering a Great Lakes body (800k vertices) takes over half an hour
    for body, members in bodies:
        entries: list[tuple[int, LonLat]] = []
        if tree is not None:
            inside = prepared.prep(body)
            entries = [(ids[i], pos[ids[i]]) for i in tree.query(body, predicate="dwithin", distance=tol)
                       if _enters(ids[i], touching[ids[i]], inside, dead_ends, body)]
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
            # within the entry tolerance: a quay is often mapped on the shoreline (Dalen bryggje on Bandak)
            for i in marina_tree.query(body, predicate="dwithin", distance=tol):
                entries.append((new_node_id(), marinas[i][1]))
        used += 1
        added.extend(_mesh(body, members, entries, bridge, weir_tree))
        if bridge is None and area_km2(body) >= BIG_LAKE_KM2:
            added.extend(_open_water(body, members, entries, weir_tree))
    log.info("lakes: %d water bodies from %d lakes, %d connected, %d synthetic segments",
             len(bodies), len(lakes), used, len(added))
    return added


BRIDGE_WINDOW_M = 10000.0
WEIR_M = 10.0  # mesh edges passing this close to a weir line are blocked
WEIR_POINT_M = 50.0
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


def _channel_windows(lakes: list[Lake], dead_end_pos: list[LonLat],
                     locks: Sequence[tuple[LonLat, LonLat]] = ()) -> list[tuple[Polygon | MultiPolygon, list[Lake]]]:
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
        out += [b for b in water_bodies(clipped, locks) if any(m.kind == "channel" for m in b[1])]
    return out


def _enters(node: int, segs: list[Segment], inside, dead_ends: set[int], body=None) -> bool:
    """A node is a way into the water only where its waterway ends there or continues into the water.

    A canal that merely runs along a reservoir's shore must not be connected through the reservoir, and a lock
    leads to another water level: the node above Skien lock is not a way into the harbour basin below it.
    """
    if node in dead_ends:
        s = segs[0]
        if s.lock and body is not None:
            # a lock ending in nothing (the river above is mapped only as an area) opens on its own side
            here, there = (s.coords[0], s.coords[-1]) if s.a == node else (s.coords[-1], s.coords[0])
            # (within a few metres: one river area holding both ends opens on both, Lilla Edet on the Göta älv)
            return body.distance(Point(here)) <= body.distance(Point(there)) + metres_to_deg(LOCK_SIDE_M)
        return True
    for s in segs:
        if s.lock:
            continue
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
    # prepared: a big lake (Huron, 800k vertices) tested point by point is far too slow otherwise
    shapes = [prepared.prep(m.polygon) for m in members]

    def name_at(p: LonLat) -> str:
        pt = Point(p)
        for i in tree.query(pt):
            if shapes[int(i)].intersects(pt):
                return members[int(i)].name
        return members[int(tree.nearest(pt))].name
    return name_at


def _mesh(body: Polygon | MultiPolygon, members: list[Lake], entries: list[tuple[int, LonLat]],
          bridge: set[int] | None = None, weirs: STRtree | None = None) -> list[Segment]:
    segs: list[Segment] = []
    if body.is_empty:
        return segs
    name_at = _lake_namer(members)

    def add(a: int, b: int, pa: LonLat, pb: LonLat):
        if a != b and pa != pb and not (weirs is not None and len(weirs.query(LineString([pa, pb]), predicate="intersects"))):
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
    return prune_and_smooth(segs, {nid for nid, _ in entries}, water, bridge, weirs)


BIG_LAKE_KM2 = 500.0
OPEN_GRID_M = 8000.0  # Mercator metres (about 5.6 km at 45°)
OPEN_CLEAR_M = 1000.0  # grid nodes stay this far (Mercator) from the shore
OPEN_SIMPLIFY_M = 50.0  # the outline is simplified this much (Mercator m) before buffering


def _open_water(body: Polygon | MultiPolygon, members: list[Lake], entries: list[tuple[int, LonLat]],
                weirs: STRtree | None = None, step: float = OPEN_GRID_M) -> list[Segment]:
    """A grid over a big lake's open water, joined to the entries: Delaunay edges and the sea mesh's grid moves
    (knight moves too, so straight courses in most directions), kept where they stay on water."""
    # simplified first: buffering a Great Lakes outline (800k vertices, thousands of islands) takes over 10 GB
    merc = shapely.simplify(shapely.transform(body, to_merc), OPEN_SIMPLIFY_M)
    x0, y0, x1, y1 = merc.bounds
    gx, gy = np.meshgrid(np.arange(x0, x1, step), np.arange(y0, y1, step))
    grid = np.column_stack([gx.ravel(), gy.ravel()])
    inner = merc.buffer(-OPEN_CLEAR_M)
    grid = grid[shapely.contains_xy(inner, grid[:, 0], grid[:, 1])] if not inner.is_empty else grid[:0]
    if not len(grid):
        return []
    ents = to_merc(np.array([p for _, p in entries])) if entries else np.zeros((0, 2))
    nodes = np.vstack([ents, grid])
    edges = shapely.get_parts(shapely.delaunay_triangles(shapely.multipoints(nodes), only_edges=True))
    edges = np.concatenate([edges[shapely.length(edges) <= 3 * step], _grid_moves(grid, x0, y0, step)])
    water = merc.buffer(ENTRY_TOLERANCE_M + OPEN_SIMPLIFY_M)
    shapely.prepare(water)
    edges = edges[shapely.contains(water, edges)]
    entry_at = {tuple(map(float, q)): nid for (nid, _), q in zip(entries, ents, strict=True)}
    name_at = _lake_namer(members)
    ids: dict[tuple[float, float], int] = {}
    seen: set[tuple[int, int]] = set()
    out: list[Segment] = []
    for e in edges:
        (ax, ay), (bx, by) = shapely.get_coordinates(e)
        a = entry_at.get((ax, ay)) or ids.setdefault((ax, ay), new_node_id())
        b = entry_at.get((bx, by)) or ids.setdefault((bx, by), new_node_id())
        if (min(a, b), max(a, b)) in seen:  # a grid move the triangulation already has
            continue
        seen.add((min(a, b), max(a, b)))
        pa, pb = (tuple(map(float, c)) for c in from_merc(np.array([[ax, ay], [bx, by]])))
        if weirs is not None and len(weirs.query(LineString([pa, pb]), predicate="intersects")):
            continue
        out.append(Segment(a=a, b=b, coords=[pa, pb], name=name_at(((pa[0] + pb[0]) / 2, (pa[1] + pb[1]) / 2)), kind="lake"))
    return out


def mark_lake_access(segs: list[Segment], lakes: list[Lake]) -> int:
    """Carry a lake's motorboat ban and speed limit onto the mesh segments crossing it; returns how many."""
    ruled = [lk for lk in lakes if lk.no_motor or lk.max_speed]
    if not ruled:
        return 0
    tree = STRtree([lk.polygon for lk in ruled])
    n = 0
    for s in segs:
        mid = s.coords[len(s.coords) // 2] if len(s.coords) > 2 else (
            (s.coords[0][0] + s.coords[-1][0]) / 2, (s.coords[0][1] + s.coords[-1][1]) / 2)
        hits = tree.query(Point(mid), predicate="intersects")
        if not len(hits):
            continue
        lk = ruled[int(hits[0])]
        s.no_motor = s.no_motor or lk.no_motor
        s.max_speed = min(x for x in (s.max_speed, lk.max_speed) if x) if (s.max_speed or lk.max_speed) else 0
        n += 1
    log.info("lake access rules on %d segments (%d lakes with a motorboat ban or speed limit)", n, len(ruled))
    return n


def prune_and_smooth(segs: list[Segment], entries: set[int], water, bridge: set[int] | None = None,
                     weirs: STRtree | None = None) -> list[Segment]:
    """Keep only mesh edges on shortest paths between entries, then straighten each chain.

    The full mesh is large (thousands of edges for a big lake) and zig-zags between triangle midpoints.
    Routes only ever run between entries, so the union of entry-to-entry shortest paths is all the
    router needs. Each chain between junctions becomes one segment whose points are reduced greedily to
    the farthest point still in line of sight over water, and not across a weir (the Oust beside Limur lock: the
    mesh went round the weir, a straightened chain cut across it).
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
    return _chains(kept, entries, water, "lake" if bridge is None else "bridge", weirs)


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


def _chains(segs: list[Segment], entries: set[int], water, kind: str = "lake", weirs: STRtree | None = None) -> list[Segment]:
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
        out.append(Segment(a=start, b=node, coords=_straighten(pts, water, weirs), name=names[len(names) // 2], kind=kind))

    for n in stop:
        for i in adj[n]:
            if i not in used:
                walk(n, i)
    # Every kept edge lies on a path between entries, so every chain reaches a stop node: no closed loops.
    return out


def _straighten(pts: list[LonLat], water, weirs: STRtree | None = None) -> list[LonLat]:
    def clear(a: LonLat, b: LonLat) -> bool:
        line = LineString([a, b])
        return water.contains(line) and not (weirs is not None and len(weirs.query(line, predicate="intersects")))

    out = [pts[0]]
    i = 0
    while i < len(pts) - 1:
        j = len(pts) - 1
        while j > i + 1 and not clear(pts[i], pts[j]):
            j -= 1
        out.append(pts[j])
        i = j
    return out
