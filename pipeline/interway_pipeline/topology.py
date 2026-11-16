"""Turns navigable OSM ways into a clean segment network."""
from __future__ import annotations

import itertools
import logging
from collections import Counter, defaultdict

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


def _split_way(w: NavWay, usage: Counter[int], ex: Extract) -> list[Segment]:
    tags = w.tags
    oneway = tags.get("oneway") in ("yes", "1", "true", "-1")
    nodes, coords = w.nodes, w.coords
    if tags.get("oneway") == "-1":
        nodes, coords = nodes[::-1], coords[::-1]
    kind = tags["kind"]
    base_lock = tags.get("lock") == "yes"
    name = tags.get("name") or tags.get("lock_name") or ""
    out: list[Segment] = []
    start = 0
    for i in range(1, len(nodes)):
        n = nodes[i]
        last = i == len(nodes) - 1
        if not (last or usage[n] > 1 or n in ex.barrier_nodes):
            continue
        seg_nodes = nodes[start:i + 1]
        interior = seg_nodes[1:-1]
        lock = base_lock or any(x in ex.lock_nodes for x in interior)
        lock_name = next((ex.lock_names[x] for x in seg_nodes if x in ex.lock_names), "")
        a, b = seg_nodes[0], seg_nodes[-1]
        # A weir/dam blocks passage: disconnect the segment at that node.
        if a in ex.barrier_nodes:
            a = new_node_id()
            barrier_ends.add(a)
        if b in ex.barrier_nodes:
            b = new_node_id()
            barrier_ends.add(b)
        if a != b or len(seg_nodes) > 2:
            out.append(Segment(
                a=a, b=b, coords=coords[start:i + 1], name=(lock_name if lock and lock_name else name),
                kind=kind, lock=lock, oneway=oneway, flows=(kind == "river"), limits=_limits(tags), osm_way=w.id,
            ))
        start = i
    return out


def add_connectors(segments: list[Segment], ex: Extract, max_length_m: float = 3000.0, tol_m: float = 60.0) -> int:
    """Short unverified rivers/canals whose both ends touch lakes or the navigable network.

    These typically link chains of lakes (e.g. Mazury) where the channel lacks boat tags. They are exported
    with the PATCH flag so the app can show them as unverified.
    """
    if not ex.connectors:
        return 0
    targets = [Point(p) for p in node_positions(segments).values()] + [lk.polygon for lk in ex.lakes]
    if not targets:
        return 0
    tree = STRtree(targets)
    tol = metres_to_deg(tol_m)
    added = 0
    for w in ex.connectors:
        if len(w.coords) < 2 or line_length(w.coords) > max_length_m:
            continue
        ends_ok = all(len(tree.query(Point(c), predicate="dwithin", distance=tol)) > 0 for c in (w.coords[0], w.coords[-1]))
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


def close_gaps(segments: list[Segment], max_gap_m: float = 25.0) -> int:
    """Connect dead ends to a nearby node of another component (common OSM mapping slips)."""
    pos = node_positions(segments)
    degree: Counter[int] = Counter()
    for s in segments:
        degree[s.a] += 1
        degree[s.b] += 1
    comp = components(segments)
    ids = list(pos)
    tree = STRtree([Point(pos[n]) for n in ids])
    added = 0
    for n in ids:
        if degree[n] != 1 or n in barrier_ends:
            continue
        p = Point(pos[n])
        best, best_d = None, max_gap_m
        for idx in tree.query(p.buffer(metres_to_deg(max_gap_m) * 2)):
            m = ids[idx]
            if comp[m] == comp[n] or m in barrier_ends:
                continue
            d = haversine(pos[n], pos[m])
            if d <= best_d:
                best, best_d = m, d
        if best is not None:
            segments.append(Segment(a=n, b=best, coords=[pos[n], pos[best]], kind="patch"))
            # merge components so we don't add redundant connectors
            old, new = comp[best], comp[n]
            for k, v in comp.items():
                if v == old:
                    comp[k] = new
            added += 1
    log.info("closed %d small gaps", added)
    return added


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
