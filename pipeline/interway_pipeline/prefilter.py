"""interway-filter: shrink an OSM extract to the objects the graph builder reads.

Country extracts are gigabytes; the builder needs only waterways, water areas, bridges, marinas and seamarks.
Filtering runs in libosmium (C++), and BackReferenceWriter adds the nodes and member ways those objects
reference, so the result is reference-complete and can be fed to `interway-build` as is.
"""
from __future__ import annotations

import argparse
import logging
from pathlib import Path

import osmium

log = logging.getLogger("interway.filter")

# Any object carrying one of these keys is kept (keys OR-ed). The builder applies the exact rules later.
KEYS = ("waterway", "water", "natural", "landuse", "leisure", "bridge", "lock", "seamark:type", "boat", "CEMT")


def prefilter(src: Path, dst: Path) -> int:
    """Write the filtered extract to dst; returns the number of directly matching objects."""
    count = 0
    with osmium.BackReferenceWriter(str(dst), ref_src=str(src), overwrite=True, remove_tags=False) as writer:
        for obj in osmium.FileProcessor(str(src)).with_filter(osmium.filter.KeyFilter(*KEYS)):
            writer.add(obj)
            count += 1
    log.info("%s -> %s: %d matching objects (%.1f -> %.1f MB)", src.name, dst.name, count,
             src.stat().st_size / 1e6, dst.stat().st_size / 1e6)
    return count


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("inputs", nargs="+", type=Path, help="OSM .pbf files")
    ap.add_argument("-o", "--out-dir", type=Path, required=True, help="where to write <name>.filtered.osm.pbf")
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    args.out_dir.mkdir(parents=True, exist_ok=True)
    for src in args.inputs:
        stem = src.name.removesuffix(".osm.pbf").removesuffix(".pbf").removesuffix(".osm")
        prefilter(src, args.out_dir / f"{stem}.filtered.osm.pbf")


if __name__ == "__main__":
    main()
