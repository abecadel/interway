"""Quality reports that help find missing connections in the waterway network."""
from __future__ import annotations

from collections import Counter

from shapely import STRtree
from shapely.geometry import Point

from .model import Segment, haversine, metres_to_deg
from .topology import components, node_positions


def gap_candidates(segments: list[Segment], max_gap_m: float = 2000.0, limit: int = 2000) -> dict:
    """GeoJSON of dead ends that lie close to a node of another component (likely missing links).

    Each feature is a line from the dead end to the nearest node of a different component, with both
    components' total length, sorted so the gaps joining the largest components come first.
    """
    pos = node_positions(segments)
    comp = components(segments)
    degree: Counter[int] = Counter()
    length: Counter[int] = Counter()
    for s in segments:
        degree[s.a] += 1
        degree[s.b] += 1
        length[comp[s.a]] += s.length
    ids = list(pos)
    tree = STRtree([Point(pos[n]) for n in ids]) if ids else None
    found = []
    for n in ids:
        if degree[n] != 1:
            continue
        best, best_d = None, max_gap_m
        for idx in tree.query(Point(pos[n]).buffer(metres_to_deg(max_gap_m) * 2)):
            m = ids[idx]
            if comp[m] != comp[n]:
                d = haversine(pos[n], pos[m])
                if d <= best_d:
                    best, best_d = m, d
        if best is not None:
            small = min(length[comp[n]], length[comp[best]])
            found.append((small, n, best, best_d))
    found.sort(key=lambda f: (-f[0], f[3]))
    seen: set[tuple[int, int]] = set()
    unique = []
    for f in found:  # the same gap is usually found from both of its ends
        key = (min(f[1], f[2]), max(f[1], f[2]))
        if key not in seen:
            seen.add(key)
            unique.append(f)
    features = [{
        "type": "Feature",
        "properties": {"gap_m": round(d), "from_component_km": round(length[comp[n]] / 1000, 1),
                       "to_component_km": round(length[comp[m]] / 1000, 1)},
        "geometry": {"type": "LineString", "coordinates": [list(pos[n]), list(pos[m])]},
    } for _, n, m, d in unique[:limit]]
    return {"type": "FeatureCollection", "features": features}
