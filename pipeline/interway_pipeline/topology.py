"""Turns navigable OSM ways into a clean segment network."""
from __future__ import annotations

import heapq
import itertools
import logging
import re
from collections import Counter, defaultdict
from dataclasses import replace

import shapely.ops
from shapely import STRtree
from shapely.geometry import LineString, Point

from .extract import Extract, NavWay
from .model import Limits, LonLat, Segment, access_of, haversine, line_length, metres_to_deg, parse_metres

log = logging.getLogger(__name__)
# the longest lock chamber in Europe is about 450 m (Kieldrecht); a lock way longer than this is not just a chamber
CHAMBER_NAME_MAX_M = 1000.0

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


DAM_NEAR_LOCK_M = 300.0  # a dam this close to a lock (gate, lock way or area) is the dam the lock passes
CHAMBER_GATE_M = 30.0  # a gate line this close to a lock way is that chamber's gate (Crinan Canal lock 3)


def add_crossings(ex: Extract) -> int:
    """Lock gates and dams drawn as lines across a waterway (the Welland Canal's locks, the Moses-Saunders dam
    across the St. Lawrence): a gate line's node on the way becomes a lock gate, a dam's a barrier. Where the line
    crosses the way without a shared node, a node is added to the way at the crossing. A dam next to a lock gate
    on the way is the dam the lock passes, so it does not cut the way."""
    lines = [(*g, True) for g in ex.gate_lines] + [(*g, False) for g in ex.dam_lines]
    if not lines:
        return 0
    tree = STRtree([g for g, *_ in lines])
    chambers = [LineString(w.coords) for w in ex.ways if w.tags.get("lock") == "yes"]
    chamber_tree = STRtree(chambers)

    def chamber_gate(p: LonLat) -> bool:
        """A gate at the end of a lock way, drawn a few metres past it onto the next way: the chamber's own gate,
        not a second lock."""
        near = chamber_tree.query(Point(p), predicate="dwithin", distance=2 * metres_to_deg(CHAMBER_GATE_M))
        return any(_metres_to(p, chambers[int(i)]) <= CHAMBER_GATE_M for i in near)

    added = 0
    dam_at: dict[int, LonLat] = {}
    for w in ex.ways:
        way_line = LineString(w.coords)
        in_chamber = w.tags.get("lock") == "yes"
        at = dict(zip(w.nodes, w.coords, strict=True))
        inserts: list[tuple[float, LonLat, bool, str]] = []
        dams: set[int] = set()
        for i in tree.query(way_line, predicate="intersects"):
            g, name, nodes, gate = lines[i]
            if gate and _OPEN_GATE.search(name):
                continue  # a guard gate stands open: boats pass it without locking
            shared = nodes.intersection(w.nodes)
            for n in shared:
                if not gate:
                    dams.add(n)
                    continue
                if not in_chamber and chamber_gate(at[n]):
                    continue
                ex.lock_nodes.add(n)
                if _names_lock(name):
                    ex.lock_names.setdefault(n, name)
            if shared:
                continue
            x = way_line.intersection(g)
            inserts += [(way_line.project(q), (q.x, q.y), gate, name) for q in getattr(x, "geoms", [x])
                        if isinstance(q, Point) and not (gate and not in_chamber and chamber_gate((q.x, q.y)))]
        nodes, coords = list(w.nodes), list(w.coords)
        if inserts:
            along = [0.0]
            for c0, c1 in itertools.pairwise(coords):
                along.append(along[-1] + Point(c0).distance(Point(c1)))
            for d, pt, gate, name in sorted(inserts, reverse=True):  # from the end, so earlier indices stay valid
                k = max(1, min(len(coords) - 1, next(k for k, v in enumerate(along) if v >= d)))
                n = new_node_id()
                nodes.insert(k, n)
                coords.insert(k, pt)
                if gate:
                    ex.lock_nodes.add(n)
                    if _names_lock(name):
                        ex.lock_names[n] = name
                else:
                    dams.add(n)
                added += 1
            w.nodes, w.coords = nodes, coords
        pos = dict(zip(nodes, coords, strict=True))
        dam_at.update((n, pos[n]) for n in dams)
    ex.barrier_nodes |= _dams_away_from_locks(ex, dam_at)
    log.info("added %d lock gate and dam crossings to waterways", added)
    return added


# an emergency or guard gate drawn across a lock is not the lock: its name ("Emergancy Lift Gate" at Lockport, IL)
# must not name the chamber
_NOT_A_LOCK_NAME = re.compile(r"emerg[ae]ncy|guard gate|spillway|flood ?gate", re.IGNORECASE)
# gates that stand open and are passed without locking: the Erie Canal's guard gates (16 between Waterford and
# Tonawanda), mapped as gate nodes or lines named so
_OPEN_GATE = re.compile(r"guard ?gate", re.IGNORECASE)


def _names_lock(name: str) -> bool:
    return bool(name) and not _NOT_A_LOCK_NAME.search(name)


def _dams_away_from_locks(ex: Extract, dam_at: dict[int, LonLat]) -> set[int]:
    """The dam nodes with no lock near: a lock gate, a lock way or a lock area within DAM_NEAR_LOCK_M. A dam next
    to a lock is the dam the lock passes, even where its line runs on past the lock way (Whitten Dam, Tenn-Tom)."""
    if not dam_at:
        return set()
    locks: list = [LineString(w.coords) for w in ex.ways if w.tags.get("lock") == "yes"]
    locks += [Point(c) for w in ex.ways for n, c in zip(w.nodes, w.coords, strict=True) if n in ex.lock_nodes]
    locks += [poly for _, poly in ex.lock_areas]
    if not locks:
        return set(dam_at)
    tree = STRtree(locks)
    away = set()
    for n, p in dam_at.items():
        near = tree.query(Point(p), predicate="dwithin", distance=2 * metres_to_deg(DAM_NEAR_LOCK_M))
        if not any(_metres_to(p, locks[int(i)]) <= DAM_NEAR_LOCK_M for i in near):
            away.add(n)
    return away


def _metres_to(p: LonLat, geom) -> float:
    """Metres from `p` to the nearest point of `geom` (geodesic between the two points)."""
    _, q = shapely.ops.nearest_points(Point(p), geom)
    return haversine(p, (q.x, q.y))


OFF_LINE_GATE_M = 40.0  # a gate node this close to a way, and on none, is a gate of that way (on its bank outline)
OFF_LINE_LOCK_NEAR_M = 50.0  # ... unless a lock already mapped on the line is this close: it is that lock's gate


def add_off_line_gates(ex: Extract) -> int:
    """Lock gates mapped beside the waterway, on the bank or the lock area's outline (Portora on the Erne), are put
    on the nearest way as lock nodes, so the chamber between them is a lock. Gates near a lock already on the line
    belong to it and are left alone. Returns how many were placed."""
    on_line = {n for w in ex.ways for n in w.nodes}
    loose = [(n, p) for n, p in ex.gate_points.items() if n not in on_line]
    if not loose:
        return 0
    locks: list = [LineString(w.coords) for w in ex.ways if w.tags.get("lock") == "yes"]
    locks += [Point(c) for w in ex.ways for n, c in zip(w.nodes, w.coords, strict=True) if n in ex.lock_nodes]
    lock_tree = STRtree(locks) if locks else None
    lines = [LineString(w.coords) for w in ex.ways]
    tree = STRtree(lines)
    inserts: dict[int, list[tuple[float, LonLat, int]]] = defaultdict(list)
    for n, p in loose:
        pt = Point(p)
        if lock_tree is not None:
            near = lock_tree.query(pt, predicate="dwithin", distance=2 * metres_to_deg(OFF_LINE_LOCK_NEAR_M))
            if any(_metres_to(p, locks[int(i)]) <= OFF_LINE_LOCK_NEAR_M for i in near):
                continue
        cands = tree.query(pt, predicate="dwithin", distance=2 * metres_to_deg(OFF_LINE_GATE_M))
        best = min(((_metres_to(p, lines[int(i)]), int(i)) for i in cands), default=None)
        if best is None or best[0] > OFF_LINE_GATE_M:
            continue
        line = lines[best[1]]
        q = line.interpolate(line.project(pt))
        inserts[best[1]].append((line.project(pt), (q.x, q.y), n))
    placed = 0
    for k, items in inserts.items():
        w = ex.ways[k]
        along = [0.0]
        for c0, c1 in itertools.pairwise(w.coords):
            along.append(along[-1] + Point(c0).distance(Point(c1)))
        nodes, coords = list(w.nodes), list(w.coords)
        for d, pt, gate in sorted(items, reverse=True):
            i = max(1, min(len(coords) - 1, next(j for j, v in enumerate(along) if v >= d)))
            nodes.insert(i, gate)  # the gate's own id: its name and lock tags stay with it
            coords.insert(i, pt)
            placed += 1
        w.nodes, w.coords = nodes, coords
    log.info("placed %d lock gates mapped beside the waterway on it", placed)
    return placed


def lock_chambers(tags: dict) -> int:
    """How many chambers a lock way is: its lock_ref lists them ("46, 47,48,49", "1-5", "21–29") on a staircase
    or flight drawn as one way (the Rideau's Kingston Mills, Göta kanal's Berg); 1 otherwise."""
    ref = tags.get("lock_ref") or ""
    n = 0
    for part in re.split(r"[;,/]", ref):
        m = re.fullmatch(r"\s*(\d+)\s*[-–]\s*(\d+)\s*", part)
        if m and 0 < int(m[2]) - int(m[1]) < 40:
            n += int(m[2]) - int(m[1]) + 1
        elif part.strip():
            n += 1
    return max(n, 1)


def split_ways(ex: Extract) -> list[Segment]:
    ex.lock_nodes -= {n for n, name in ex.lock_names.items() if _OPEN_GATE.search(name)}
    # gates beside the way first: placed on it, they are the locks a dam next to them is passed by (Portora)
    add_off_line_gates(ex)
    add_crossings(ex)
    # a dam or weir mapped on a lock way is the dam the lock passes (the Oswego Canal's "Lock Number 5" dam node
    # on the Minetto lock): boats go through, so it does not cut the waterway
    ex.barrier_nodes -= {n for w in ex.ways if w.tags.get("lock") == "yes" for n in w.nodes}
    usage: Counter[int] = Counter()
    for w in ex.ways:
        usage.update(set(w.nodes))
        usage[w.nodes[0]] += 1
        usage[w.nodes[-1]] += 1
    # a gate on a lock=yes way is that chamber's gate: on the way beyond it, it starts no chamber of its own
    chamber_gates = {n for w in ex.ways if w.tags.get("lock") == "yes" for n in w.nodes} & ex.lock_nodes
    approaches = lock_approaches(ex.ways)
    segments: list[Segment] = []
    for w in ex.ways:
        segments.extend(_split_way(w, usage, ex, chamber_gates, w.id in approaches))
    log.info("split %d ways into %d segments", len(ex.ways), len(segments))
    return segments


CHAMBER_PIECE_M = 50.0  # lock=yes pieces shorter than this (links at the gates) are not chambers
APPROACH_MIN_M = 250.0  # a lock=yes way this long, and twice the chamber it continues, is the lock's approach


def lock_approaches(ways: list[NavWay]) -> set[int]:
    """The lock=yes ways that are a lock's approach, not a chamber: in a chain of lock=yes ways joined end to end,
    those longer than APPROACH_MIN_M and twice the shortest of the chain (Lock 14 on the Mississippi: a 230 m
    chamber, then 800 m of lower approach tagged lock=yes). The chambers of a staircase are alike and all count."""
    locks = [w for w in ways if w.tags.get("lock") == "yes"]
    at: dict[int, list[int]] = defaultdict(list)
    for i, w in enumerate(locks):
        for n in {w.nodes[0], w.nodes[-1]}:
            at[n].append(i)
    seen: set[int] = set()
    out: set[int] = set()
    for i in range(len(locks)):
        if i in seen:
            continue
        chain, todo = [], [i]
        seen.add(i)
        while todo:
            k = todo.pop()
            chain.append(k)
            for n in {locks[k].nodes[0], locks[k].nodes[-1]}:
                for j in at[n]:
                    if j not in seen:
                        seen.add(j)
                        todo.append(j)
        if len(chain) < 2:
            continue
        length = {k: line_length(locks[k].coords) for k in chain}
        # the chamber to compare with: short pieces at the gates are no chamber (Iron Gates I's 310 m chambers
        # with 20 m links between them are a staircase, not approaches)
        chambers = [v for v in length.values() if v >= CHAMBER_PIECE_M]
        if not chambers:
            continue
        shortest = min(chambers)
        out |= {locks[k].id for k in chain if length[k] > max(APPROACH_MIN_M, 2 * shortest)}
    return out


LOCK_GROUP_M = 400.0  # lock gates closer than this along a way belong to the same chamber


def _lock_groups(nodes: list[int], coords: list[LonLat], ex: Extract, chamber_gates: set[int]) -> list[tuple[int, int]]:
    """Index ranges (first gate, last gate) of lock chambers along a way, from its lock gate nodes. A range whose
    gates all belong to chambers mapped as their own lock=yes way is the short pound between two such chambers
    (Office Lock and River Lock, Leeds), not a chamber; one with a gate of its own is the next chamber of a
    staircase."""
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
    return [(g0, g1) for g0, g1 in groups if not (g0 == g1 and g0 in (0, len(nodes) - 1))
            and not all(n in chamber_gates for n in nodes[g0:g1 + 1] if n in ex.lock_nodes)]


def _split_way(w: NavWay, usage: Counter[int], ex: Extract, chamber_gates: set[int], approach: bool = False) -> list[Segment]:
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
    base_lock = tags.get("lock") == "yes" and not approach
    # lock_name names a lock chamber only: on a long lock cut or approach it would name kilometres of canal after
    # the lock ("Écluse n°10 d'Ars-sur-Moselle", 11 km)
    name = tags.get("name") or ""
    groups = [] if base_lock else _lock_groups(nodes, coords, ex, chamber_gates)
    chambers = {(g0, g1) for g0, g1 in groups if g0 < g1}
    single_gates = {g0 for g0, g1 in groups if g0 == g1}
    cuts = {i for g in groups for i in g}

    def lock_name_of(i0: int, i1: int) -> str:
        return next((ex.lock_names[x] for x in nodes[i0:i1 + 1] if x in ex.lock_names), tags.get("lock_name", ""))

    out: list[Segment] = []
    no_motor, max_speed = access_of(tags)
    chambers_n = lock_chambers(tags)

    def emit(a: int, b: int, pts: list[LonLat], lock: bool, seg_name: str) -> None:
        # A weir/dam blocks passage: disconnect the segment at that node.
        if a in ex.barrier_nodes:
            a = new_node_id()
            barrier_ends.add(a)
        if b in ex.barrier_nodes:
            b = new_node_id()
            barrier_ends.add(b)
        if a != b or len(pts) > 2:
            # a flight drawn as one lock way is as many locks as its chambers: split it into that many
            parts = _split_line(pts, chambers_n) if lock and base_lock and chambers_n > 1 else [pts]
            ends = [a] + [new_node_id() for _ in parts[1:]] + [b]
            for k, part in enumerate(parts):
                out.append(Segment(a=ends[k], b=ends[k + 1], coords=part, name=seg_name, kind=kind, lock=lock,
                                   oneway=oneway, flows=(kind == "river"), limits=_limits(tags), osm_way=w.id,
                                   no_motor=no_motor, max_speed=max_speed))

    start, start_node = 0, nodes[0]
    for i in range(1, len(nodes)):
        n = nodes[i]
        if not (i == len(nodes) - 1 or usage[n] > 1 or n in ex.barrier_nodes or i in cuts):
            continue
        is_chamber = base_lock or (start, i) in chambers
        # a lock=yes way far longer than a chamber is a lock approach drawn as the lock: it keeps the waterway's name
        chamber_like = is_chamber and not (base_lock and line_length(coords[start:i + 1]) > CHAMBER_NAME_MAX_M)
        seg_name = (lock_name_of(start, i) or name) if chamber_like else name
        if i in single_gates:
            # the way continues from a new node; the gate itself becomes a zero-length lock between them
            gate = new_node_id()
            emit(start_node, n, coords[start:i + 1], is_chamber, seg_name)
            out.append(Segment(a=n, b=gate, coords=[coords[i], coords[i]], name=lock_name_of(i, i) or name,
                               kind=kind, lock=True, oneway=oneway, limits=_limits(tags), osm_way=w.id,
                               no_motor=no_motor, max_speed=max_speed))
            start, start_node = i, gate
            continue
        emit(start_node, n, coords[start:i + 1], is_chamber, seg_name)
        start, start_node = i, n
    return out


def _split_line(pts: list[LonLat], k: int) -> list[list[LonLat]]:
    """`pts` cut into k pieces of equal length."""
    line = LineString(pts)
    marks = [line.interpolate(j / k, normalized=True) for j in range(k + 1)]
    out = []
    for j in range(k):
        piece = shapely.ops.substring(line, j / k, (j + 1) / k, normalized=True)
        cs = list(piece.coords) if piece.geom_type == "LineString" else [(marks[j].x, marks[j].y)] * 2
        out.append([(x, y) for x, y in cs])
    return out


CONNECTOR_WEIR_M = 10.0  # a connector channel passing this close to a weir is closed by it


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

    # a weir drawn as a line across the channel (Limur on the Oust, beside the lock) closes it as a weir node does
    weirs = STRtree([wr.buffer(metres_to_deg(CONNECTOR_WEIR_M)) for wr in ex.weirs]) if ex.weirs else None
    added = 0
    for w in ex.connectors:
        if len(w.coords) < 2 or line_length(w.coords) > max_length_m:
            continue
        if weirs is not None and len(weirs.query(LineString(w.coords), predicate="intersects")):
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


def apply_bridges(segments: list[Segment], bridges: list[tuple[LineString, float]],
                  found: list[tuple[LonLat, float]] | None = None) -> int:
    """Limit air draft on segments crossed by bridges; `found` collects (crossing point, clearance)."""
    if not bridges or not segments:
        return 0
    lines = [LineString(s.coords) for s in segments]
    tree = STRtree(lines)
    hits = 0
    for line, clearance in bridges:
        for idx in tree.query(line, predicate="intersects"):
            segments[idx].limits.tighten_height(clearance)
            hits += 1
            if found is not None:
                p = line.intersection(lines[idx]).representative_point()
                found.append(((p.x, p.y), clearance))
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
    Such ends may already be connected the long way round (Niederfinow: the Oder and the Havel also meet through
    the Oder-Spree-Kanal), so they are joined unless the network already links them within LIFT_DETOUR_M.
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
    adj: dict[int, list[tuple[int, float]]] = defaultdict(list)
    for s in segments:
        adj[s.a].append((s.b, s.length))
        adj[s.b].append((s.a, s.length))
    added = 0
    for n in ids:
        if degree[n] != 1 or n in barrier_ends:
            continue
        p = Point(pos[n])
        best, best_d = None, float("inf")
        for idx in tree.query(p.buffer(metres_to_deg(max(max_gap_m, dead_end_gap_m)) * 2)):
            m = ids[idx]
            if m == n or m in barrier_ends:
                continue
            d = haversine(pos[n], pos[m])
            if not (d < best_d and (d <= max_gap_m or (degree[m] == 1 and d <= dead_end_gap_m))):
                continue
            if root(comp[m]) == root(comp[n]) and (d <= max_gap_m or _within(adj, n, m, LIFT_DETOUR_M)):
                continue
            best, best_d = m, d
        if best is not None:
            # A join longer than a mapping slip spans a ship lift or a lock mapped only as an area: it changes
            # level, so it is routed like a lock (and is never a lock-free bypass around a real lock).
            segments.append(Segment(a=n, b=best, coords=[pos[n], pos[best]], kind="patch", lock=best_d > max_gap_m))
            parent[root(comp[best])] = root(comp[n])
            adj[n].append((best, best_d))
            adj[best].append((n, best_d))
            added += 1
    log.info("closed %d small gaps", added)
    return added


LIFT_DETOUR_M = 5000.0


def _within(adj: dict[int, list[tuple[int, float]]], src: int, dst: int, max_m: float) -> bool:
    """Whether dst is reachable from src over at most max_m of network."""
    dist = {src: 0.0}
    heap = [(0.0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if u == dst:
            return True
        for v, w in adj[u]:
            nd = d + w
            if nd <= max_m and nd < dist.get(v, float("inf")):
                dist[v] = nd
                heapq.heappush(heap, (nd, v))
    return False


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
        merged = replace(s, b=t.b, coords=s.coords + t.coords[1:], lock=False)  # same merge_key: same attributes
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
    return replace(s, a=s.b, b=s.a, coords=s.coords[::-1])


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
    removed. A bypass may run through a lake mesh (a reservoir whose shore reaches the dam crest), but lake
    segments are never cut: touching lakes are merged regardless of level. Bypasses that contain another lock
    are not bypasses at all. A cut never disconnects anything: a segment is removed
    only if its ends stay connected another way (through locks allowed). Returns (kept, removed).
    """
    adj: dict[int, list[int]] = defaultdict(list)
    for i, s in enumerate(segments):
        adj[s.a].append(i)
        adj[s.b].append(i)
    lengths = [s.length for s in segments]
    removed: set[int] = set()
    converted = 0
    for idx, lock in enumerate(segments):
        if not lock.lock or lock.a == lock.b:
            continue
        small = _boat_lock(lock)
        ends = (lock.a, lock.b)
        for _ in range(MAX_BYPASS_CUTS):
            path = _bypass(segments, adj, lengths, removed, *ends, max_m)
            if not path and ends == (lock.a, lock.b):
                # A staircase (Iron Gates I: two chambers and a basin): every way round one chamber passes the
                # other, so look for the way round the whole staircase.
                ends = (_staircase_end(segments, adj, lengths, removed, lock.a, idx),
                        _staircase_end(segments, adj, lengths, removed, lock.b, idx))
                if ends != (lock.a, lock.b):
                    path = _bypass(segments, adj, lengths, removed, *ends, max_m)
            if not path:
                break
            if small:
                # A small boat lock beside the main channel: the channel holds the ship lock (unmapped, or mapped
                # only as an area). Cutting it would leave bigger boats no way through; make it the lock instead.
                cands = _weir_candidates(segments, path, ends, lengths)
                if cands:
                    segments[cands[0]].lock = True
                    converted += 1
                small = False
                continue
            cut = next((c for c in _weir_candidates(segments, path, ends, lengths)
                        if _bypass(segments, adj, lengths, removed | {c}, segments[c].a, segments[c].b, 2 * max_m,
                                   through_locks=True)), None)
            if cut is None:
                break
            removed.add(cut)
    kept = [s for i, s in enumerate(segments) if i not in removed]
    log.info("removed %d segments bypassing locks (unmapped weirs, untagged twin chambers)", len(removed))
    log.info("treated %d channels beside small boat locks as their ship lock", converted)
    return kept, [segments[i] for i in sorted(removed)]


MAX_BYPASS_CUTS = 10
# A lock this narrow or short is a boat lock (Bootsschleuse, sportboot lock); large rivers have a ship lock next to it.
BOAT_LOCK_WIDTH_M = 6.0
BOAT_LOCK_LENGTH_M = 40.0


def _boat_lock(lock: Segment) -> bool:
    w, n = lock.limits.max_width, lock.limits.max_length
    return 0 < w <= BOAT_LOCK_WIDTH_M or 0 < n <= BOAT_LOCK_LENGTH_M


def _staircase_end(segments, adj, lengths, removed, node: int, came: int) -> int:
    """The far end of a lock staircase, leaving `node` away from segment `came`: through further chambers and
    unbranched basins of at most STAIRCASE_BASIN_M. `node` itself when no chamber follows."""
    end, basin, seen = node, 0.0, {came}
    while True:
        nxt = [i for i in adj[node] if i not in seen and i not in removed]
        if len(nxt) != 1 or segments[nxt[0]].kind in ("lake", "sea"):
            return end
        i = nxt[0]
        seen.add(i)
        node = segments[i].b if segments[i].a == node else segments[i].a
        if segments[i].lock:
            end, basin = node, 0.0
        else:
            basin += lengths[i]
            if basin > STAIRCASE_BASIN_M:
                return end


STAIRCASE_BASIN_M = 1500.0


def _weir_candidates(segments: list[Segment], path: list[int], ends: tuple[int, int], lengths: list[float]) -> list[int]:
    """Segments of a bypass in the order they should be cut: where the unmapped weir most likely is first.

    Segments touching the lock's own ends are the canal leading to it, so they come last (they are the bypass
    itself only for an untagged twin chamber). Rivers and river-area bridges come before canals, then longer
    before shorter.
    """
    return sorted((i for i in path if segments[i].kind not in ("lake", "sea")),
                  key=lambda i: (not ({segments[i].a, segments[i].b} & set(ends)),
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


def mark_lock_areas(segments: list[Segment], areas: list, max_m: float = 1000.0) -> int:
    """Lock chambers mapped only as a water=lock area (gates drawn as lines across the way, Przegalina): a
    short segment lying mostly inside such an area is the chamber, so it becomes a lock."""
    if not areas:
        return 0
    polys = [p for _, p in areas]
    tree = STRtree(polys)
    marked = 0
    for s in segments:
        if s.lock or s.length > max_m:
            continue
        line = LineString(s.coords)
        for i in tree.query(line, predicate="intersects"):
            if line.length and line.intersection(polys[i]).length >= 0.5 * line.length:
                s.lock = True
                s.name = areas[i][0]  # the river name would mislabel the lock; unnamed shows as "Lock"
                marked += 1
                break
    log.info("marked %d segments inside lock areas as locks", marked)
    return marked
