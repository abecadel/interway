"""Turns navigable OSM ways into a clean segment network."""
from __future__ import annotations

import heapq
import itertools
import logging
from collections import Counter, defaultdict
from dataclasses import replace

from shapely import STRtree
from shapely.geometry import LineString, Point

from .extract import Extract, NavWay
from .model import Limits, LonLat, Segment, haversine, line_length, metres_to_deg, parse_metres

log = logging.getLogger(__name__)

_synthetic = itertools.count(-1, -1)
# Node ids created where a weir/dam cut a waterway; gap closing must not reconnect them.
barrier_ends: set[int] = set()


def new_node_id() -> int:
    """Synthetic node ids are negative so they never clash with OSM node ids."""
    return next(_synthetic)


def _limits(tags: dict[str, str]) -> Limits:
    return Limits(
        max_draft=parse_metres(tags.get("maxdraft") or tags.get("draft")),
        max_height=parse_metres(tags.get("maxheight")),
        max_width=parse_metres(tags.get("maxwidth")),
        max_length=parse_metres(tags.get("maxlength")),
    )


def split_ways(ex: Extract) -> list[Segment]:
    usage: Counter[int] = Counter()
    for w in ex.ways:
        usage.update(set(w.nodes))
        usage[w.nodes[0]] += 1
        usage[w.nodes[-1]] += 1
    segments: list[Segment] = []
    for w in ex.ways:
        segments.extend(_split_way(w, usage, ex))
    log.info("split %d ways into %d segments", len(ex.ways), len(segments))
    return segments


LOCK_GROUP_M = 400.0  # lock gates closer than this along a way belong to the same chamber


def _lock_groups(nodes: list[int], coords: list[LonLat], ex: Extract) -> list[tuple[int, int]]:
    """Index ranges (first gate, last gate) of lock chambers along a way, from its lock gate nodes."""
    groups: list[list[int]] = []
    along = [0.0]
    for i in range(1, len(coords)):
        along.append(along[-1] + haversine(coords[i - 1], coords[i]))
    for i, n in enumerate(nodes):
        if n not in ex.lock_nodes:
            continue
        if groups and along[i] - along[groups[-1][1]] <= LOCK_GROUP_M:
            groups[-1][1] = i
        else:
            groups.append([i, i])
    # a single gate at the very end of a way belongs to the chamber way it joins (tagged lock=yes)
    return [(g0, g1) for g0, g1 in groups if not (g0 == g1 and g0 in (0, len(nodes) - 1))]


def _split_way(w: NavWay, usage: Counter[int], ex: Extract) -> list[Segment]:
    """Cut a way at junctions, weirs and lock chambers.

    A lock is its own short segment: the stretch between the first and last gate of a chamber, or a
    zero-length segment where only one gate is mapped. The rest of the way is never flagged as a lock.
    """
    tags = w.tags
    oneway = tags.get("oneway") in ("yes", "1", "true", "-1")
    nodes, coords = list(w.nodes), list(w.coords)
    if tags.get("oneway") == "-1":
        nodes, coords = nodes[::-1], coords[::-1]
    kind = tags["kind"]
    base_lock = tags.get("lock") == "yes"
    name = tags.get("name") or tags.get("lock_name") or ""
    groups = [] if base_lock else _lock_groups(nodes, coords, ex)
    chambers = {(g0, g1) for g0, g1 in groups if g0 < g1}
    single_gates = {g0 for g0, g1 in groups if g0 == g1}
    cuts = {i for g in groups for i in g}

    def lock_name_of(i0: int, i1: int) -> str:
        return next((ex.lock_names[x] for x in nodes[i0:i1 + 1] if x in ex.lock_names), tags.get("lock_name", ""))

    out: list[Segment] = []

    def emit(a: int, b: int, pts: list[LonLat], lock: bool, seg_name: str) -> None:
        # A weir/dam blocks passage: disconnect the segment at that node.
        if a in ex.barrier_nodes:
            a = new_node_id()
            barrier_ends.add(a)
        if b in ex.barrier_nodes:
            b = new_node_id()
            barrier_ends.add(b)
        if a != b or len(pts) > 2:
            out.append(Segment(a=a, b=b, coords=pts, name=seg_name, kind=kind, lock=lock, oneway=oneway,
                               flows=(kind == "river"), limits=_limits(tags), osm_way=w.id))

    start, start_node = 0, nodes[0]
    for i in range(1, len(nodes)):
        n = nodes[i]
        if not (i == len(nodes) - 1 or usage[n] > 1 or n in ex.barrier_nodes or i in cuts):
            continue
        is_chamber = base_lock or (start, i) in chambers
        seg_name = (lock_name_of(start, i) or name) if is_chamber else name
        if i in single_gates:
            # the way continues from a new node; the gate itself becomes a zero-length lock between them
            gate = new_node_id()
            emit(start_node, n, coords[start:i + 1], is_chamber, seg_name)
            out.append(Segment(a=n, b=gate, coords=[coords[i], coords[i]], name=lock_name_of(i, i) or name,
                               kind=kind, lock=True, oneway=oneway, limits=_limits(tags), osm_way=w.id))
            start, start_node = i, gate
            continue
        emit(start_node, n, coords[start:i + 1], is_chamber, seg_name)
        start, start_node = i, n
    return out


def add_connectors(segments: list[Segment], ex: Extract, max_length_m: float = 3000.0, tol_m: float = 60.0) -> int:
    """Short unverified rivers/canals between lakes, or from a lake to the navigable network.

    These typically link chains of lakes (e.g. Mazury) where the channel lacks boat tags. At least one end must
    be at a lake: pieces of a small river joining a canal at both ends would otherwise become lock-free
    shortcuts beside it. They are exported with the PATCH flag so the app can show them as unverified.
    """
    if not ex.connectors:
        return 0
    lake_polys = [lk.polygon for lk in ex.lakes if lk.kind == "lake"]
    if not lake_polys:
        return 0
    lake_tree = STRtree(lake_polys)
    node_pts = [Point(p) for p in node_positions(segments).values()]
    node_tree = STRtree(node_pts) if node_pts else None
    tol = metres_to_deg(tol_m)

    def at_lake(c: LonLat) -> bool:
        return len(lake_tree.query(Point(c), predicate="dwithin", distance=tol)) > 0

    def at_network(c: LonLat) -> bool:
        return node_tree is not None and len(node_tree.query(Point(c), predicate="dwithin", distance=tol)) > 0

    added = 0
    for w in ex.connectors:
        if len(w.coords) < 2 or line_length(w.coords) > max_length_m:
            continue
        first, last = w.coords[0], w.coords[-1]
        ends_ok = (at_lake(first) and (at_lake(last) or at_network(last))) or (at_lake(last) and at_network(first))
        if not ends_ok or any(n in ex.barrier_nodes for n in w.nodes):
            continue
        a, b = w.nodes[0], w.nodes[-1]
        if a == b:
            continue
        segments.append(Segment(a=a, b=b, coords=w.coords, name=w.tags.get("name", ""), kind="connector",
                                lock=w.tags.get("lock") == "yes" or any(n in ex.lock_nodes for n in w.nodes),
                                limits=_limits(w.tags), osm_way=w.id))
        added += 1
    log.info("added %d short connector channels", added)
    return added


def apply_bridges(segments: list[Segment], bridges: list[tuple[LineString, float]]) -> int:
    if not bridges or not segments:
        return 0
    tree = STRtree([LineString(s.coords) for s in segments])
    hits = 0
    for line, clearance in bridges:
        for idx in tree.query(line, predicate="intersects"):
            segments[idx].limits.tighten_height(clearance)
            hits += 1
    log.info("applied %d bridge clearances", hits)
    return hits


def node_positions(segments: list[Segment]) -> dict[int, LonLat]:
    pos: dict[int, LonLat] = {}
    for s in segments:
        pos.setdefault(s.a, s.coords[0])
        pos.setdefault(s.b, s.coords[-1])
    return pos


def components(segments: list[Segment]) -> dict[int, int]:
    parent: dict[int, int] = {}

    def find(x: int) -> int:
        parent.setdefault(x, x)
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for s in segments:
        ra, rb = find(s.a), find(s.b)
        if ra != rb:
            parent[ra] = rb
    return {n: find(n) for n in list(parent)}


def close_gaps(segments: list[Segment], max_gap_m: float = 25.0, dead_end_gap_m: float = 0.0) -> int:
    """Connect dead ends to a nearby node of another component.

    Within `max_gap_m` any node qualifies (common mapping slips). Up to `dead_end_gap_m` only another dead end
    does: two waterway ends facing each other across a ship lift, a lock mapped as an area or a short culvert.
    """
    pos = node_positions(segments)
    degree: Counter[int] = Counter()
    for s in segments:
        degree[s.a] += 1
        degree[s.b] += 1
    comp = components(segments)
    # union-find over component labels, so joining two components is O(1) instead of relabelling every node
    parent: dict[int, int] = {}

    def root(c: int) -> int:
        while parent.get(c, c) != c:
            c = parent[c]
        return c

    ids = list(pos)
    tree = STRtree([Point(pos[n]) for n in ids])
    added = 0
    for n in ids:
        if degree[n] != 1 or n in barrier_ends:
            continue
        p = Point(pos[n])
        best, best_d = None, float("inf")
        for idx in tree.query(p.buffer(metres_to_deg(max(max_gap_m, dead_end_gap_m)) * 2)):
            m = ids[idx]
            if root(comp[m]) == root(comp[n]) or m in barrier_ends:
                continue
            d = haversine(pos[n], pos[m])
            if d < best_d and (d <= max_gap_m or (degree[m] == 1 and d <= dead_end_gap_m)):
                best, best_d = m, d
        if best is not None:
            # A join longer than a mapping slip spans a ship lift or a lock mapped only as an area: it changes
            # level, so it is routed like a lock (and is never a lock-free bypass around a real lock).
            segments.append(Segment(a=n, b=best, coords=[pos[n], pos[best]], kind="patch", lock=best_d > max_gap_m))
            parent[root(comp[best])] = root(comp[n])
            added += 1
    log.info("closed %d small gaps", added)
    return added


def snap_dead_ends_to_lines(segments: list[Segment], max_gap_m: float = 25.0) -> int:
    """Join dead ends that stop next to another waterway's line rather than at one of its nodes.

    Mappers often end a side canal right beside the main canal without sharing a node (an unconnected
    T-junction, e.g. the Aigues-Mortes branch of the Canal du Rhône à Sète). The other waterway is split at its
    nearest vertex and joined to the dead end. Returns the number of joins.
    """
    degree: Counter[int] = Counter()
    for sg in segments:
        degree[sg.a] += 1
        degree[sg.b] += 1
    comp = components(segments)
    verts: list[tuple[int, int]] = []  # (segment index, interior vertex index)
    pts = []
    for i, sg in enumerate(segments):
        for k in range(1, len(sg.coords) - 1):
            verts.append((i, k))
            pts.append(Point(sg.coords[k]))
    if not pts:
        return 0
    tree = STRtree(pts)
    pos = node_positions(segments)
    radius = metres_to_deg(max_gap_m) * 2
    splits: dict[int, dict[int, list[int]]] = defaultdict(lambda: defaultdict(list))  # seg -> vertex -> ends
    for n, d in degree.items():
        if d != 1 or n in barrier_ends:
            continue
        best, best_d = None, max_gap_m
        for idx in tree.query(Point(pos[n]).buffer(radius)):
            i, k = verts[idx]
            if comp[segments[i].a] == comp[n]:
                continue
            dist = haversine(pos[n], segments[i].coords[k])
            if dist <= best_d:
                best, best_d = (i, k), dist
        if best is not None:
            splits[best[0]][best[1]].append(n)
    joins = 0
    for i, at in splits.items():
        sg = segments[i]
        cut = sorted(at)
        nodes = [sg.a] + [new_node_id() for _ in cut] + [sg.b]
        bounds = [0, *cut, len(sg.coords) - 1]
        pieces = [replace(sg, a=nodes[j], b=nodes[j + 1], coords=sg.coords[bounds[j]:bounds[j + 1] + 1])
                  for j in range(len(bounds) - 1)]
        segments[i] = pieces[0]
        segments.extend(pieces[1:])
        for j, k in enumerate(cut, start=1):
            for n in at[k]:
                segments.append(Segment(a=n, b=nodes[j], coords=[pos[n], sg.coords[k]], kind="patch"))
                joins += 1
    log.info("joined %d dead ends to the middle of another waterway", joins)
    return joins


def merge_degree2(segments: list[Segment]) -> list[Segment]:
    """Join consecutive segments with identical attributes so the graph only keeps junctions."""
    by_node: dict[int, list[int]] = defaultdict(list)
    for i, s in enumerate(segments):
        by_node[s.a].append(i)
        if s.b != s.a:
            by_node[s.b].append(i)
    alive = [True] * len(segments)
    for node, idxs in list(by_node.items()):
        live = [i for i in idxs if alive[i]]
        if len(live) != 2:
            continue
        i, j = live
        s, t = segments[i], segments[j]
        if s.lock or t.lock or s.merge_key() != t.merge_key() or s.a == s.b or t.a == t.b:
            continue
        # orient so that s ends at node and t starts at node, without reversing directed segments
        order = _orient(s, t, node)
        if order is None:
            order = _orient(t, s, node)
            if order is None:
                continue
            i, j = j, i
        s, t = order
        if s.a == t.b:
            continue  # would create a loop segment
        merged = Segment(a=s.a, b=t.b, coords=s.coords + t.coords[1:], name=s.name, kind=s.kind, lock=False,
                         oneway=s.oneway, flows=s.flows, limits=s.limits, osm_way=s.osm_way)
        segments[i] = merged
        alive[j] = False
        # update incidence lists in place: the loop above holds references to them
        lst = by_node[t.b]
        lst[:] = [i if k == j else k for k in lst]
        by_node[node].clear()
    out = [s for s, ok in zip(segments, alive, strict=True) if ok]
    log.info("merged degree-2 nodes: %d -> %d segments", len(segments), len(out))
    return out


def _reversed(s: Segment) -> Segment:
    return Segment(a=s.b, b=s.a, coords=s.coords[::-1], name=s.name, kind=s.kind, lock=s.lock, oneway=s.oneway,
                   flows=s.flows, limits=s.limits, osm_way=s.osm_way)


def _orient(first: Segment, second: Segment, node: int) -> tuple[Segment, Segment] | None:
    """Return (first, second) possibly reversed so first ends and second starts at node."""
    directed = first.flows or first.oneway
    if first.b != node:
        if directed or first.a != node:
            return None
        first = _reversed(first)
    if second.a != node:
        if directed or second.b != node:
            return None
        second = _reversed(second)
    return first, second


def drop_small_components(segments: list[Segment], min_length_m: float) -> tuple[list[Segment], list[dict]]:
    comp = components(segments)
    total: Counter[int] = Counter()
    for s in segments:
        total[comp[s.a]] += s.length
    keep = {c for c, length in total.items() if length >= min_length_m}
    report = [{"component": c, "length_m": round(length)} for c, length in total.most_common()]
    out = [s for s in segments if comp[s.a] in keep]
    log.info("components: %d total, %d kept (>= %.0f m); %d segments dropped",
             len(total), len(keep), min_length_m, len(segments) - len(out))
    return out, report


def block_lock_bypasses(segments: list[Segment], max_m: float = 30_000.0) -> tuple[list[Segment], list[Segment]]:
    """Remove lock-free branches that run around a lock.

    A lock joins two different water levels, so any path between its two ends that uses no lock must cross a
    weir or dam, even when OSM has no weir node on it: an untagged twin chamber, a weir arm next to a lock
    canal, a river loop around a canalised section. For each lock the shortest such bypass within `max_m` is
    removed. Lake crossings are never removed (touching lakes are merged regardless of level), and bypasses
    that contain another lock are not bypasses at all. A cut never disconnects anything: a segment is removed
    only if its ends stay connected another way (through locks allowed). Returns (kept, removed).
    """
    adj: dict[int, list[int]] = defaultdict(list)
    for i, s in enumerate(segments):
        adj[s.a].append(i)
        adj[s.b].append(i)
    lengths = [s.length for s in segments]
    removed: set[int] = set()
    for lock in segments:
        if not lock.lock or lock.a == lock.b:
            continue
        for _ in range(MAX_BYPASS_CUTS):
            path = _bypass(segments, adj, lengths, removed, lock.a, lock.b, max_m)
            if not path or any(segments[i].kind == "lake" for i in path):
                break
            cut = next((c for c in _weir_candidates(segments, path, lock, lengths)
                        if _bypass(segments, adj, lengths, removed | {c}, segments[c].a, segments[c].b, 2 * max_m,
                                   through_locks=True)), None)
            if cut is None:
                break
            removed.add(cut)
    kept = [s for i, s in enumerate(segments) if i not in removed]
    log.info("removed %d segments bypassing locks (unmapped weirs, untagged twin chambers)", len(removed))
    return kept, [segments[i] for i in sorted(removed)]


MAX_BYPASS_CUTS = 10


def _weir_candidates(segments: list[Segment], path: list[int], lock: Segment, lengths: list[float]) -> list[int]:
    """Segments of a bypass in the order they should be cut: where the unmapped weir most likely is first.

    Segments touching the lock's own ends are the canal leading to it, so they come last (they are the bypass
    itself only for an untagged twin chamber). Rivers and river-area bridges come before canals, then longer
    before shorter.
    """
    return sorted(path, key=lambda i: (not ({segments[i].a, segments[i].b} & {lock.a, lock.b}),
                                       segments[i].kind in ("river", "bridge"), lengths[i]), reverse=True)


def _bypass(segments, adj, lengths, removed, src: int, dst: int, max_m: float,
            through_locks: bool = False) -> list[int] | None:
    """Shortest path src -> dst (segment indices) not longer than max_m and, unless through_locks, using no lock."""
    dist = {src: 0.0}
    prev: dict[int, int] = {}
    heap = [(0.0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if u == dst:
            path = []
            while u != src:
                i = prev[u]
                path.append(i)
                u = segments[i].a if segments[i].b == u else segments[i].b
            return path
        if d > dist[u]:
            continue
        for i in adj[u]:
            s = segments[i]
            if (s.lock and not through_locks) or i in removed:
                continue
            v = s.b if s.a == u else s.a
            nd = d + lengths[i]
            if nd <= max_m and nd < dist.get(v, float("inf")):
                dist[v] = nd
                prev[v] = i
                heapq.heappush(heap, (nd, v))
    return None
