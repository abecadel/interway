"""interway-merge: join separately built regions (Europe, North America) into one data pack.

Each region is built on its own (`interway-build`), so its extracts and lake meshes fit in memory and an
allowlist change in one region does not re-read the other. Their networks never touch (an ocean apart), so
the merged graph is the regions' graphs side by side: node, edge, geometry and point indices of each later
region are offset by the counts before it, attribute rows and names are merged into one table each.
"""
from __future__ import annotations

import argparse
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from .export import MAX_ATTRS, _write

log = logging.getLogger("interway.merge")
INDEX_LIMIT = 2**32  # node, edge, geometry and point indices are u32


def _read(b: bytes, magic: bytes, nheader: int, fields) -> tuple[dict, list[int]]:
    if b[:4] != magic:
        raise ValueError(f"not an Interway file (magic {b[:4]!r}, expected {magic!r})")
    header = [int(x) for x in np.frombuffer(b, "<u4", nheader + 1, 4)]
    if header[0] != 1:
        raise ValueError(f"unsupported version {header[0]}")
    pos = 8 + 4 * nheader
    out = {}
    for name, dt, cnt in fields(*header[1:]):
        out[name] = np.frombuffer(b, dt, cnt, pos)
        pos += (out[name].nbytes + 3) & ~3
    return out, header[1:]


def read_pack(d: Path) -> dict:
    """graph.bin, geom.bin, manifest.json and pois.json of a built data directory."""
    manifest = json.loads((d / "manifest.json").read_text(encoding="utf-8"))
    g, _ = _read((d / manifest["files"]["graph"]).read_bytes(), b"IWG1", 3, lambda n, m, a: [
        ("lat", "<i4", n), ("lon", "<i4", n), ("off", "<u4", n + 1), ("tgt", "<u4", m), ("len", "<f4", m),
        ("geom", "<u4", m), ("attr", "<u2", m), ("flags", "<u2", m), ("attrs", "<f4", a * 4)])
    s, _ = _read((d / manifest["files"]["geom"]).read_bytes(), b"IWS1", 2, lambda gc, p: [
        ("from", "<u4", gc), ("to", "<u4", gc), ("off", "<u4", gc + 1), ("lat", "<i4", p), ("lon", "<i4", p),
        ("name", "<u4", gc)])
    pois_file = manifest["files"].get("pois")
    pois = json.loads((d / pois_file).read_text(encoding="utf-8")) if pois_file and (d / pois_file).exists() else []
    return {"manifest": manifest, "graph": g, "geom": s, "pois": pois}


def merge(dirs: list[Path], out: Path, region: str) -> dict:
    packs = [read_pack(d) for d in dirs]
    names: list[str] = [""]
    name_at = {"": 0}
    attrs: list[tuple] = [(0.0, 0.0, 0.0, 0.0)]
    attr_at = {attrs[0]: 0}
    cols: dict[str, list[np.ndarray]] = {k: [] for k in (
        "lat", "lon", "off", "tgt", "len", "geom", "attr", "flags", "gfrom", "gto", "goff", "plat", "plon", "gname")}
    n = m = gcount = p = 0
    for pk in packs:
        g, s, man = pk["graph"], pk["geom"], pk["manifest"]
        name_map = np.zeros(len(man["names"]), dtype="<u4")
        for i, nm in enumerate(man["names"]):
            name_map[i] = name_at.setdefault(nm, len(names))
            if name_map[i] == len(names):
                names.append(nm)
        rows = g["attrs"].reshape(-1, 4)
        attr_map = np.zeros(len(rows), dtype="<u2")
        for i, row in enumerate(map(tuple, rows.tolist())):
            if row not in attr_at:
                if len(attrs) >= MAX_ATTRS:
                    raise ValueError("attribute table full")
                attr_at[row] = len(attrs)
                attrs.append(row)
            attr_map[i] = attr_at[row]
        cols["lat"].append(g["lat"])
        cols["lon"].append(g["lon"])
        cols["off"].append((g["off"][:-1] if pk is not packs[-1] else g["off"]).astype(np.uint64) + m)
        cols["tgt"].append(g["tgt"].astype(np.uint64) + n)
        cols["len"].append(g["len"])
        cols["geom"].append(g["geom"].astype(np.uint64) + gcount)
        cols["attr"].append(attr_map[g["attr"]])
        cols["flags"].append(g["flags"])
        cols["gfrom"].append(s["from"].astype(np.uint64) + n)
        cols["gto"].append(s["to"].astype(np.uint64) + n)
        cols["goff"].append((s["off"][:-1] if pk is not packs[-1] else s["off"]).astype(np.uint64) + p)
        cols["plat"].append(s["lat"])
        cols["plon"].append(s["lon"])
        cols["gname"].append(name_map[s["name"]])
        n, m, gcount, p = n + len(g["lat"]), m + len(g["tgt"]), gcount + len(s["from"]), p + len(s["lat"])
    if max(n, m, gcount, p) >= INDEX_LIMIT:
        raise ValueError("merged pack too large for 32-bit indices")

    def cat(k: str, dt: str) -> np.ndarray:
        return np.concatenate(cols[k]).astype(dt)

    out.mkdir(parents=True, exist_ok=True)
    graph_sha = _write(out / "graph.bin", b"IWG1", [n, m, len(attrs)], [
        cat("lat", "<i4"), cat("lon", "<i4"), cat("off", "<u4"), cat("tgt", "<u4"), cat("len", "<f4"),
        cat("geom", "<u4"), cat("attr", "<u2"), cat("flags", "<u2"), np.array(attrs, dtype="<f4").reshape(-1)])
    geom_sha = _write(out / "geom.bin", b"IWS1", [gcount, p], [
        cat("gfrom", "<u4"), cat("gto", "<u4"), cat("goff", "<u4"), cat("plat", "<i4"), cat("plon", "<i4"),
        cat("gname", "<u4")])
    pois = [x for pk in packs for x in pk["pois"]]
    (out / "pois.json").write_text(json.dumps(pois, ensure_ascii=False), encoding="utf-8")
    mans = [pk["manifest"] for pk in packs]
    attributions: list[str] = []
    for man in mans:
        for a in man.get("attribution", "").split(" · "):
            if a and a not in attributions:
                attributions.append(a)
    manifest = {
        "version": 1,
        "region": region,
        "regions": [man.get("region", "") for man in mans],
        "countries": sorted({c for man in mans for c in man.get("countries", [])}),
        "sea": any(man.get("sea") for man in mans),
        "osmTimestamp": min((man.get("osmTimestamp") or "" for man in mans), default=""),
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "files": {"graph": "graph.bin", "geom": "geom.bin", "pois": "pois.json"},
        "sha256": {"graph": graph_sha, "geom": geom_sha},
        "stats": {"nodes": n, "edges": m, "segments": gcount, "points": p},
        "names": names,
        "attribution": " · ".join(attributions),
    }
    (out / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    log.info("merged %d regions: %d nodes, %d edges, %d points to %s", len(packs), n, m, p, out)
    return manifest


def main(argv: list[str] | None = None) -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="+", type=Path, help="built data directories (manifest.json, graph.bin, ...)")
    ap.add_argument("-o", "--out", type=Path, required=True)
    ap.add_argument("--region", required=True, help='label of the merged pack, e.g. "Europe + North America"')
    args = ap.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    print(json.dumps(merge(args.inputs, args.out, args.region)["stats"]))


if __name__ == "__main__":
    main()
