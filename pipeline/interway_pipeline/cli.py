"""interway-build: OSM extract(s) -> static routing data for the web app."""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import pickle
from pathlib import Path

from shapely import STRtree
from shapely.geometry import Point

from .classify import Allowlist
from .export import export
from .extract import Extract, read_osm
from .lakes import connect_lakes
from .model import Segment, haversine
from .topology import add_connectors, apply_bridges, close_gaps, drop_small_components, merge_degree2, node_positions, split_ways

log = logging.getLogger("interway")
REPO = Path(__file__).resolve().parents[2]


def merge_extracts(parts: list[Extract]) -> Extract:
    if len(parts) == 1:
        return parts[0]
    ex = Extract()
    seen_ways, seen_lakes, seen_bridges, seen_marinas = set(), set(), set(), set()
    for p in parts:
        for w in p.ways:
            if w.id not in seen_ways:
                seen_ways.add(w.id)
                ex.ways.append(w)
        for lake in p.lakes:
            if lake.id not in seen_lakes:
                seen_lakes.add(lake.id)
                ex.lakes.append(lake)
        ex.lock_nodes |= p.lock_nodes
        ex.barrier_nodes |= p.barrier_nodes
        ex.lock_names.update(p.lock_names)
        # overlapping extracts (neighbouring countries) contain the same border objects twice
        for b in p.bridges:
            if (b[0].wkb, b[1]) not in seen_bridges:
                seen_bridges.add((b[0].wkb, b[1]))
                ex.bridges.append(b)
        for m in p.marinas:
            if m not in seen_marinas:
                seen_marinas.add(m)
                ex.marinas.append(m)
        for w in p.connectors:
            if w.id not in seen_ways:
                seen_ways.add(w.id)
                ex.connectors.append(w)
        ex.timestamp = max(ex.timestamp, p.timestamp)
    return ex


def apply_patches(segments: list[Segment], patch_dir: Path | None, max_snap_m: float = 300.0) -> int:
    """Manual connectors: GeoJSON LineStrings whose ends are snapped to the nearest graph node."""
    if patch_dir is None or not patch_dir.exists():
        return 0
    pos = node_positions(segments)
    ids = list(pos)
    if not ids:
        return 0
    tree = STRtree([Point(pos[n]) for n in ids])
    added = 0
    for f in sorted(patch_dir.glob("*.geojson")):
        for feat in json.loads(f.read_text(encoding="utf-8")).get("features", []):
            geom = feat.get("geometry") or {}
            if geom.get("type") != "LineString":
                continue
            coords = [tuple(c[:2]) for c in geom["coordinates"]]
            ends = []
            for c in (coords[0], coords[-1]):
                i = tree.nearest(Point(c))
                ends.append(ids[i] if haversine(c, pos[ids[i]]) <= max_snap_m else None)
            if None in ends:
                log.warning("patch %s in %s: end not within %.0f m of the network", feat.get("properties"), f.name, max_snap_m)
                continue
            if ends[0] == ends[1]:
                log.warning("patch %s in %s: both ends snap to the same node", feat.get("properties"), f.name)
                continue
            coords[0], coords[-1] = pos[ends[0]], pos[ends[1]]
            props = feat.get("properties") or {}
            segments.append(Segment(a=ends[0], b=ends[1], coords=coords, name=props.get("name", ""),
                                    kind="patch", lock=bool(props.get("lock"))))
            added += 1
    log.info("applied %d manual patches", added)
    return added


def read_cached(path: Path, allow: Allowlist, cache_dir: Path | None) -> Extract:
    """read_osm with an optional pickle cache keyed by file, size, mtime and allowlist."""
    if cache_dir is None:
        return read_osm(path, allow)
    st = path.stat()
    key = hashlib.sha256(repr((str(path.resolve()), st.st_size, st.st_mtime, sorted(allow.names), sorted(allow.lakes),
                              sorted(allow.wikidata), sorted(allow.exclude_names), EXTRACT_VERSION)).encode()).hexdigest()[:16]
    f = cache_dir / f"{path.name}.{key}.pickle"
    if f.exists():
        log.info("using cached extract %s", f.name)
        return pickle.loads(f.read_bytes())
    ex = read_osm(path, allow)
    cache_dir.mkdir(parents=True, exist_ok=True)
    f.write_bytes(pickle.dumps(ex, protocol=pickle.HIGHEST_PROTOCOL))
    return ex


EXTRACT_VERSION = 3  # bump when read_osm output changes, invalidates --cache


def build(inputs: list[Path], out: Path, *, region: str, allowlist: Path | None, patches: Path | None,
          min_component_km: float = 2.0, simplify_m: float = 5.0, cache_dir: Path | None = None) -> dict:
    allow = Allowlist.load(allowlist)
    ex = merge_extracts([read_cached(p, allow, cache_dir) for p in inputs])
    segments = split_ways(ex)
    add_connectors(segments, ex)
    apply_bridges(segments, ex.bridges)
    segments += connect_lakes(segments, ex.lakes, ex.marinas)
    close_gaps(segments)
    apply_patches(segments, patches)
    segments = merge_degree2(segments)
    segments, report = drop_small_components(segments, min_component_km * 1000)

    pois = [{"type": "lock", "name": s.name, "lon": s.coords[len(s.coords) // 2][0], "lat": s.coords[len(s.coords) // 2][1]}
            for s in segments if s.lock]
    if ex.marinas and segments:
        pos = node_positions(segments)
        tree = STRtree([Point(p) for p in pos.values()])
        pts = list(pos.values())
        for name, p in ex.marinas:
            q = pts[tree.nearest(Point(p))]
            if haversine(p, q) < 2000:
                pois.append({"type": "marina", "name": name, "lon": p[0], "lat": p[1]})
    manifest = export(segments, out, region=region, osm_timestamp=ex.timestamp, pois=pois, simplify_m=simplify_m)
    (out / "qa-components.json").write_text(json.dumps(report[:500], indent=0), encoding="utf-8")
    return manifest


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("inputs", nargs="+", type=Path, help="OSM .pbf/.osm files (e.g. Geofabrik country extracts)")
    ap.add_argument("-o", "--out", type=Path, default=REPO / "app" / "public" / "data")
    ap.add_argument("--region", default="europe")
    ap.add_argument("--allowlist", type=Path, default=REPO / "data" / "navigable")
    ap.add_argument("--patches", type=Path, default=REPO / "data" / "patches")
    ap.add_argument("--min-component-km", type=float, default=2.0)
    ap.add_argument("--simplify-m", type=float, default=5.0)
    ap.add_argument("--cache", type=Path, default=None, help="directory for cached extracts (speeds up re-runs)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    m = build(args.inputs, args.out, region=args.region, allowlist=args.allowlist, patches=args.patches,
              min_component_km=args.min_component_km, simplify_m=args.simplify_m, cache_dir=args.cache)
    print(json.dumps(m["stats"]))


if __name__ == "__main__":
    main()
