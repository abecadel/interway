"""interway-fishing-pois: add the places anglers look for to a built data directory without a full rebuild.

Reads only what it needs from OSM extracts (fishing spots, tackle shops, wrecks, obstructions, fish farms; see
pois.FISHING_KINDS), keeps those near the built network (its geom.bin, within `pois.json`'s distances), and
writes them into the directory's pois.json next to what is there (earlier fishing places are replaced).
"""
from __future__ import annotations

import argparse
import json
import logging
from pathlib import Path

import numpy as np
import osmium
import shapely
from shapely import STRtree

from .extract import _area_polygon
from .merge import read_pack
from .model import haversine
from .pois import FISHING_KINDS, poi_type, port_info

log = logging.getLogger("interway.fishing")
KEYS = ("leisure", "shop", "seamark:type", "landuse")
NEAR_M = {"fishing": 3000.0, "tackle": 3000.0}  # others (at the water): 1000 m
NEAR_DEFAULT_M = 1000.0
INFO = {"tackle", "wreck"}


def read_fishing(paths: list[Path]) -> list[dict]:
    """The fishing places in the extracts, each once (areas at a point inside them)."""
    out: list[dict] = []
    seen: set[tuple[str, int]] = set()
    for path in paths:
        fp = osmium.FileProcessor(str(path)).with_filter(osmium.filter.KeyFilter(*KEYS)).with_areas()
        for o in fp:
            tags = {t.k: t.v for t in o.tags}
            kind = poi_type(tags)
            if kind not in FISHING_KINDS:
                continue
            if o.is_node():
                if not o.location.valid():
                    continue
                key, pos = ("n", o.id), (o.lon, o.lat)
            elif o.is_area():
                poly = _area_polygon(o)
                if poly is None:
                    continue
                key, c = ("a", o.id), poly.representative_point()
                pos = (c.x, c.y)
            else:  # the closed way an area is made from: the area stands for it
                continue
            if key in seen:
                continue
            seen.add(key)
            poi = {"type": kind, "name": tags.get("name", ""), "lon": pos[0], "lat": pos[1]}
            if kind in INFO:
                poi.update(dict(port_info(tags)))
            out.append(poi)
    return out


def network_lines(data_dir: Path) -> list:
    """The built network's geometries (geom.bin) as lines, or points for one-point geometries."""
    s = read_pack(data_dir)["geom"]
    xy = np.column_stack([s["lon"] / 1e7, s["lat"] / 1e7])
    off = s["off"]
    return [shapely.linestrings(xy[off[g]:off[g + 1]]) if off[g + 1] - off[g] >= 2 else shapely.points(xy[off[g]])
            for g in range(len(s["from"]))]


def near_network(pois: list[dict], lines: list) -> list[dict]:
    if not pois or not lines:
        return []
    tree = STRtree(lines)
    kept = []
    for poi in pois:
        pt = shapely.points(poi["lon"], poi["lat"])
        line = lines[tree.nearest(pt)]
        q = shapely.get_coordinates(shapely.line_interpolate_point(line, shapely.line_locate_point(line, pt)))[0] \
            if line.geom_type == "LineString" else shapely.get_coordinates(line)[0]
        if haversine((poi["lon"], poi["lat"]), (q[0], q[1])) <= NEAR_M.get(poi["type"], NEAR_DEFAULT_M):
            kept.append(poi)
    return kept


def add_fishing(data_dir: Path, extracts: list[Path]) -> dict[str, int]:
    manifest = json.loads((data_dir / "manifest.json").read_text(encoding="utf-8"))
    pois_file = data_dir / manifest["files"].get("pois", "pois.json")
    pois = json.loads(pois_file.read_text(encoding="utf-8")) if pois_file.exists() else []
    found = near_network(read_fishing(extracts), network_lines(data_dir))
    merged = [p for p in pois if p["type"] not in FISHING_KINDS] + found
    pois_file.write_text(json.dumps(merged, ensure_ascii=False), encoding="utf-8")
    if "pois" not in manifest["files"]:
        manifest["files"]["pois"] = pois_file.name
        (data_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    counts: dict[str, int] = {}
    for p in found:
        counts[p["type"]] = counts.get(p["type"], 0) + 1
    log.info("added %s to %s", counts, pois_file)
    return counts


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("data_dir", type=Path, help="a built data directory (manifest.json, geom.bin, pois.json)")
    ap.add_argument("extracts", nargs="+", type=Path, help="OSM extracts (.osm.pbf), e.g. the prefiltered ones")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    print(json.dumps(add_fishing(args.data_dir, args.extracts)))


if __name__ == "__main__":
    main()
