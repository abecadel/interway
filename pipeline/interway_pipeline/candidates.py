"""interway-candidates: rivers and canals the network leaves out but that show signs of navigation.

The builder takes a river or canal only on evidence (CEMT class, ship/motorboat tags, seamark fairways, locks,
or an allowlisted name), so a waterway whose OSM tags say little is missing without any warning. This report
lists named rivers and canals that are not taken but carry some sign of boats: boat/motorboat tags, lock gates,
a marina, port or slipway close by, or a junction with a navigable waterway. Grouped by name and sorted by a
score, it is a reading list for the allowlists: each candidate still has to be confirmed in a national
waterway list before it goes into data/navigable/.
"""
from __future__ import annotations

import argparse
import json
import logging
from dataclasses import dataclass, field
from pathlib import Path

import osmium
from shapely import STRtree
from shapely.geometry import LineString, Point

from .classify import YES, Allowlist, is_connector_candidate, is_navigable_way
from .model import LonLat, haversine, metres_to_deg
from .pois import poi_type

log = logging.getLogger("interway.candidates")

HARBOUR_KINDS = {"marina", "port", "slipway"}
NEAR_HARBOUR_M = 300.0


@dataclass
class Candidate:
    name: str
    source: str
    lines: list[list[LonLat]] = field(default_factory=list)
    km: float = 0.0
    boat: int = 0  # ways tagged boat/motorboat yes
    locks: int = 0  # lock gates on the ways
    junctions: int = 0  # ways sharing a node with a navigable waterway
    harbours: int = 0  # ways with a marina, port or slipway close by

    @property
    def score(self) -> float:
        signs = 2 * bool(self.boat) + 2 * bool(self.locks) + bool(self.junctions) + bool(self.harbours)
        return round(self.km * signs, 1)


def _coords(way) -> list[LonLat]:
    try:
        return [(n.lon, n.lat) for n in way.nodes]
    except osmium.InvalidLocationError:
        return []


def scan(path: Path, allow: Allowlist) -> list[Candidate]:
    """Candidates in one OSM file, best first."""
    lock_nodes: set[int] = set()
    harbours: list[LonLat] = []
    navigable_nodes: set[int] = set()
    ways: list[tuple[str, list[int], list[LonLat], bool]] = []
    for o in osmium.FileProcessor(str(path)).with_locations():
        tags = o.tags
        if o.is_node():
            if tags.get("waterway") == "lock_gate" or tags.get("lock") == "yes":
                lock_nodes.add(o.id)
            if poi_type(tags) in HARBOUR_KINDS and o.location.valid():
                harbours.append((o.lon, o.lat))
        elif o.is_way():
            if is_navigable_way(tags, allow, lambda o=o: _coords(o)):
                navigable_nodes.update(n.ref for n in o.nodes)
                continue
            if poi_type(tags) in HARBOUR_KINDS:
                try:
                    harbours.append((o.nodes[0].lon, o.nodes[0].lat))
                except osmium.InvalidLocationError:
                    pass
                continue
            name = tags.get("name")
            if not name or not is_connector_candidate(tags, allow):
                continue
            coords = _coords(o)
            if not coords:
                continue  # cut at the extract's border
            boat = tags.get("boat") in YES or tags.get("motorboat") in YES
            ways.append((name, [n.ref for n in o.nodes], coords, boat))

    tree = STRtree([Point(p) for p in harbours]) if harbours else None
    near = metres_to_deg(NEAR_HARBOUR_M)
    groups: dict[str, Candidate] = {}
    for name, refs, coords, boat in ways:
        c = groups.setdefault(name, Candidate(name, path.name.split(".")[0]))
        c.lines.append(coords)
        c.km += sum(haversine(a, b) for a, b in zip(coords, coords[1:], strict=False)) / 1000
        c.boat += boat
        c.locks += sum(r in lock_nodes for r in refs)
        c.junctions += any(r in navigable_nodes for r in refs)
        line = LineString(coords) if len(coords) > 1 else Point(coords[0])
        c.harbours += bool(tree is not None and len(tree.query(line, predicate="dwithin", distance=near)))
    return sorted((c for c in groups.values() if c.score > 0), key=lambda c: -c.score)


def to_geojson(cands: list[Candidate]) -> dict:
    return {"type": "FeatureCollection", "features": [{
        "type": "Feature",
        "properties": {"name": c.name, "source": c.source, "km": round(c.km, 1), "ways": len(c.lines), "boat": c.boat,
                       "locks": c.locks, "junctions": c.junctions, "harbours": c.harbours, "score": c.score},
        "geometry": {"type": "MultiLineString", "coordinates": c.lines},
    } for c in cands]}


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="+", type=Path, help="filtered OSM .pbf files (one per country)")
    ap.add_argument("--allowlist", type=Path, default=Path(__file__).resolve().parents[2] / "data" / "navigable")
    ap.add_argument("-o", "--out", type=Path, required=True, help="GeoJSON report")
    ap.add_argument("--top", type=int, default=20, help="candidates per input listed on stdout")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    allow = Allowlist.load(args.allowlist)
    found: list[Candidate] = []
    for path in args.inputs:
        cands = scan(path, allow)
        log.info("%s: %d candidates", path.name, len(cands))
        for c in cands[:args.top]:
            print(f"{c.source}\t{c.score}\t{c.km:.1f} km\tboat {c.boat}\tlocks {c.locks}\tjunctions {c.junctions}"
                  f"\tharbours {c.harbours}\t{c.name}")
        found += cands
    args.out.write_text(json.dumps(to_geojson(found)))


if __name__ == "__main__":
    main()
