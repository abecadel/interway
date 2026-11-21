"""interway-build: OSM extract(s) -> static routing data for the web app."""
from __future__ import annotations

import argparse
import hashlib
import json
import logging
import pickle
from pathlib import Path

from shapely import STRtree
from shapely.geometry import LineString, Point

from .classify import Allowlist
from .depth import ATTRIBUTION as DEPTH_ATTRIBUTION
from .depth import DepthGrid, apply_sea_depth, tile_loader
from .export import export
from .extract import Extract, read_osm
from .lakes import connect_lakes, mark_lake_access
from .model import Segment, haversine
from .pois import load_places
from .qa import gap_candidates
from .sea import DEFAULT_BBOX, Coast, connect_to_sea, drop_sheltered, mark_offshore, sea_mesh, to_merc
from .topology import (
    add_connectors,
    apply_bridges,
    block_lock_bypasses,
    close_gaps,
    drop_small_components,
    mark_lock_areas,
    merge_degree2,
    new_node_id,
    node_positions,
    snap_dead_ends_to_lines,
    split_ways,
)

log = logging.getLogger("interway")
REPO = Path(__file__).resolve().parents[2]


def promote_ways(ex: Extract, ids: set[int]) -> int:
    """Moves the allowlisted way ids from the connector candidates to the navigable ways. Applied after the
    (cached) extract, so allowlisting a way by id re-reads no country file."""
    if not ids:
        return 0
    found = [w for w in ex.connectors if w.id in ids]
    ex.connectors = [w for w in ex.connectors if w.id not in ids]
    ex.ways += found
    missing = ids - {w.id for w in ex.ways}
    if missing:
        log.warning("allowlisted way ids not among the river/canal ways read: %s", sorted(missing))
    log.info("allowlisted %d ways by id", len(found))
    return len(found)


def merge_extracts(parts: list[Extract]) -> Extract:
    if len(parts) == 1:
        return parts[0]
    ex = Extract()
    seen_ways, seen_lakes, seen_bridges, seen_marinas, seen_services, seen_locks = set(), set(), set(), set(), set(), set()
    for p in parts:
        for w in p.ways:
            if w.id not in seen_ways:
                seen_ways.add(w.id)
                ex.ways.append(w)
        for lake in p.lakes:
            if lake.id not in seen_lakes:
                seen_lakes.add(lake.id)
                ex.lakes.append(lake)
        for name, poly in p.lock_areas:
            if poly.wkb not in seen_locks:
                seen_locks.add(poly.wkb)
                ex.lock_areas.append((name, poly))
        ex.lock_nodes |= p.lock_nodes
        ex.barrier_nodes |= p.barrier_nodes
        ex.lock_names.update(p.lock_names)
        ex.weirs += p.weirs  # duplicates from overlapping extracts block the same edges
        # overlapping extracts (neighbouring countries) contain the same border objects twice
        for b in p.bridges:
            if (b[0].wkb, b[1]) not in seen_bridges:
                seen_bridges.add((b[0].wkb, b[1]))
                ex.bridges.append(b)
        for m in p.marinas:
            if m not in seen_marinas:
                seen_marinas.add(m)
                ex.marinas.append(m)
        for sv in p.services:
            if sv not in seen_services:
                seen_services.add(sv)
                ex.services.append(sv)
        for w in p.connectors:
            if w.id not in seen_ways:
                seen_ways.add(w.id)
                ex.connectors.append(w)
        ex.timestamp = max(ex.timestamp, p.timestamp)
    return ex


def apply_patches(segments: list[Segment], patch_dir: Path | None, max_snap_m: float = 300.0,
                  weirs: list | None = None) -> int:
    """Manual connectors: GeoJSON LineStrings whose ends are snapped to the nearest graph node.

    A LineString with the property "weir" is instead a weir OSM does not map, added to `weirs`: no lake or
    river-area mesh edge crosses it (the Widuchowa weir at the head of the West Oder).
    """
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
            props = feat.get("properties") or {}
            if props.get("weir"):
                if weirs is not None:
                    weirs.append(LineString(coords))
                continue
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
                              sorted(allow.wikidata), sorted(allow.exclude_names),
                              [x.pattern for x in allow.exclude_patterns], EXTRACT_VERSION)).encode()).hexdigest()[:16]
    f = cache_dir / f"{path.name}.{key}.pickle"
    if f.exists():
        log.info("using cached extract %s", f.name)
        return pickle.loads(f.read_bytes())
    ex = read_osm(path, allow)
    cache_dir.mkdir(parents=True, exist_ok=True)
    f.write_bytes(pickle.dumps(ex, protocol=pickle.HIGHEST_PROTOCOL))
    return ex


EXTRACT_VERSION = 14  # bump when read_osm output changes, invalidates --cache


def itinerary_pois(segments: list[Segment], services: list, bridge_points: list, max_m: float = 1000.0,
                   place_m: float = 3000.0) -> list[dict]:
    """Points of interest for route itineraries: locks, bridges with clearance, services near the network and
    towns within place_m of it."""
    pois: list[dict] = []
    for s in segments:
        if s.lock:
            lon, lat = s.coords[len(s.coords) // 2]
            poi = {"type": "lock", "name": s.name, "lon": lon, "lat": lat}
            if s.limits.max_length:
                poi["maxlength"] = s.limits.max_length
            if s.limits.max_width:
                poi["maxwidth"] = s.limits.max_width
            pois.append(poi)
    for (lon, lat), clearance in bridge_points:
        pois.append({"type": "bridge", "name": "", "lon": lon, "lat": lat, "clearance": clearance})
    if services and segments:
        lines = [LineString(s.coords) for s in segments]
        tree = STRtree(lines)
        for kind, name, p, facts in services:
            nearest = lines[tree.nearest(Point(p))]
            q = nearest.interpolate(nearest.project(Point(p)))
            if haversine(p, (q.x, q.y)) <= (place_m if kind == "place" else max_m):
                pois.append({"type": kind, "name": name, "lon": p[0], "lat": p[1], **dict(facts)})
    return pois


def sea_network(land: Path, areas: list[dict], cache_dir: Path | None) -> tuple[Coast, list[Segment]]:
    """Land polygons and the sea mesh over `areas` (cached by land file and areas). Mesh node ids are renumbered
    so they never clash with ids made in this run."""
    coast = Coast.load(land, [tuple(a["bbox"]) for a in areas])
    sea = None
    f = None
    if cache_dir is not None:
        st = land.stat()
        key = hashlib.sha256(repr((str(land.resolve()), st.st_size, st.st_mtime, areas, SEA_VERSION)).encode()).hexdigest()[:16]
        f = cache_dir / f"sea.{key}.pickle"
        if f.exists():
            log.info("using cached sea mesh %s", f.name)
            sea = pickle.loads(f.read_bytes())
    if sea is None:
        sea = sea_mesh(coast, areas=areas)
        if f is not None:
            cache_dir.mkdir(parents=True, exist_ok=True)
            f.write_bytes(pickle.dumps(sea, protocol=pickle.HIGHEST_PROTOCOL))
    ids: dict[int, int] = {}
    for s in sea:
        s.a = ids.setdefault(s.a, new_node_id())
        s.b = ids.setdefault(s.b, new_node_id())
    return coast, sea


def meshed_lakes(lakes: list, lake_segs: list[Segment]) -> list:
    """Polygons of the lakes (not river or canal areas) that got a mesh: some mesh point lies inside."""
    polys = [lk.polygon for lk in lakes if lk.kind == "lake"]
    pts = [Point(c) for s in lake_segs if s.kind == "lake" for c in s.coords]
    if not polys or not pts:
        return []
    hit = STRtree(pts).query(polys, predicate="contains")[0]
    return [polys[i] for i in sorted(set(hit.tolist()))]


# depth samples closer to land than this (Mercator m, ~1.2-1.6 km in Europe) are left out: harbour approaches
SHORE_M = 2000.0
SEA_VERSION = 5  # bump when sea_mesh output changes, invalidates cached meshes


def build(inputs: list[Path], out: Path, *, region: str, allowlist: Path | None, patches: Path | None,
          min_component_km: float = 2.0, simplify_m: float = 5.0, cache_dir: Path | None = None,
          dead_end_gap_m: float = 300.0, countries: list[str] | None = None, land: Path | None = None,
          sea_bbox: tuple[float, float, float, float] = DEFAULT_BBOX, places: Path | None = None,
          depth_cache: Path | None = None, depth_scale: float = 0.25, sea_areas: list[dict] | None = None) -> dict:
    allow = Allowlist.load(allowlist)
    ex = merge_extracts([read_cached(p, allow, cache_dir) for p in inputs])
    promote_ways(ex, allow.ways)
    segments = split_ways(ex)
    mark_lock_areas(segments, ex.lock_areas)
    add_connectors(segments, ex)
    bridge_points: list = []
    apply_bridges(segments, ex.bridges, bridge_points)
    # Manual patches first: a gap they close (inclined planes, lifts) is no longer a dead end below.
    apply_patches(segments, patches, weirs=ex.weirs)
    # Dead-end joins (lifts, area-mapped locks, T-junctions) look at the line network alone: lake and river-area
    # meshes added afterwards would turn the facing ends into junctions and hide the gap.
    close_gaps(segments, dead_end_gap_m=dead_end_gap_m)
    snap_dead_ends_to_lines(segments)
    # marinas and harbours (passenger quays: the Telemark Canal boats at Dalen) are places to steer to on a lake
    harbours = ex.marinas + [(name, p) for kind, name, p, _ in ex.services if kind == "port"]
    lake_segs = connect_lakes(segments, ex.lakes, harbours, ex.weirs)
    mark_lake_access(lake_segs, ex.lakes)
    segments += lake_segs
    close_gaps(segments)  # mapping slips at the lake meshes
    if land is not None:
        coast, sea = sea_network(land, sea_areas or [{"bbox": tuple(sea_bbox)}], cache_dir)
        sea = drop_sheltered(sea, meshed_lakes(ex.lakes, lake_segs))
        mark_offshore(sea, coast)
        if depth_cache is not None:  # mesh edges only: links into harbours and river mouths keep no limit
            apply_sea_depth(sea, DepthGrid(tile_loader(depth_cache, depth_scale)),
                            near_land=lambda p: coast.near_land(to_merc(p), SHORE_M))
        segments += connect_to_sea(segments, sea, coast) + sea
    segments = merge_degree2(segments)
    segments, bypasses = block_lock_bypasses(segments)
    segments, report = drop_small_components(segments, min_component_km * 1000)

    pois = itinerary_pois(segments, ex.services + (load_places(places) if places else []), bridge_points)
    manifest = export(segments, out, region=region, osm_timestamp=ex.timestamp, countries=countries, pois=pois,
                      simplify_m=simplify_m, sea=land is not None,
                      attribution=" · ".join(["© OpenStreetMap contributors, ODbL"]
                                             + (["towns © GeoNames, CC BY 4.0"] if places else [])
                                             + ([DEPTH_ATTRIBUTION] if depth_cache is not None and land is not None else [])))
    (out / "qa-components.json").write_text(json.dumps(report[:500], indent=0), encoding="utf-8")
    (out / "qa-gaps.geojson").write_text(json.dumps(gap_candidates(segments)), encoding="utf-8")
    (out / "qa-lock-bypasses.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"name": s.name, "kind": s.kind},
         "geometry": {"type": "LineString", "coordinates": [list(c) for c in s.coords]}} for s in bypasses]}), encoding="utf-8")
    return manifest


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("inputs", nargs="+", type=Path, help="OSM .pbf/.osm files (e.g. Geofabrik country extracts)")
    ap.add_argument("-o", "--out", type=Path, default=REPO / "app" / "public" / "data")
    ap.add_argument("--region", default="europe")
    ap.add_argument("--countries", default="", help="ISO codes of countries the inputs fully cover, e.g. PL,DE,NL")
    ap.add_argument("--allowlist", type=Path, default=REPO / "data" / "navigable")
    ap.add_argument("--patches", type=Path, default=REPO / "data" / "patches")
    ap.add_argument("--min-component-km", type=float, default=2.0)
    ap.add_argument("--simplify-m", type=float, default=5.0)
    ap.add_argument("--dead-end-gap-m", type=float, default=300.0,
                    help="join two dead ends of different network parts up to this far apart (ship lifts, locks as areas)")
    ap.add_argument("--cache", type=Path, default=None, help="directory for cached extracts (speeds up re-runs)")
    ap.add_argument("--land", type=Path, default=None,
                    help="OSM land polygons shapefile (land-polygons-split-4326/land_polygons.shp) to add sea routes")
    ap.add_argument("--sea-bbox", default=",".join(map(str, DEFAULT_BBOX)), help="west,south,east,north of the sea mesh")
    ap.add_argument("--sea-areas", type=Path, default=None,
                    help='sea areas JSON ({"name", "bbox": [w, s, e, n], optional "max_offshore_m"}) instead of --sea-bbox')
    ap.add_argument("--places", type=Path, default=None, help="GeoNames cities5000.txt: towns along routes")
    ap.add_argument("--depth-cache", type=Path, default=None,
                    help="directory for EMODnet bathymetry tiles; enables depth limits on sea routes (needs --land)")
    ap.add_argument("--depth-scale", type=float, default=0.25, help="EMODnet grid downsampling (1 = ~115 m cells)")
    ap.add_argument("-v", "--verbose", action="store_true")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.DEBUG if args.verbose else logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    m = build(args.inputs, args.out, region=args.region, allowlist=args.allowlist, patches=args.patches,
              min_component_km=args.min_component_km, simplify_m=args.simplify_m, cache_dir=args.cache,
              dead_end_gap_m=args.dead_end_gap_m, land=args.land, places=args.places,
              depth_cache=args.depth_cache, depth_scale=args.depth_scale,
              sea_bbox=tuple(float(v) for v in args.sea_bbox.split(",")),
              sea_areas=json.loads(args.sea_areas.read_text()) if args.sea_areas else None,
              countries=[c.strip().upper() for c in args.countries.split(",") if c.strip()])
    print(json.dumps(m["stats"]))


if __name__ == "__main__":
    main()
