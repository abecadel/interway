"""Writes graph.bin, geom.bin, pois.json and manifest.json (docs/graph-format.md)."""
from __future__ import annotations

import hashlib
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from shapely.geometry import LineString

from .model import CANAL, DOWNSTREAM, GEOM_REVERSED, LAKE, LOCK, PATCH, SEA, UPSTREAM, Segment, metres_to_deg

log = logging.getLogger(__name__)
SCALE = 1e7
MAX_ATTRS = 65535  # edgeAttr is u16


def _pad(b: bytes) -> bytes:
    return b + b"\0" * (-len(b) % 4)


def _write(path: Path, magic: bytes, header: list[int], arrays: list[np.ndarray]) -> str:
    out = bytearray(magic + np.array([1, *header], dtype="<u4").tobytes())
    for a in arrays:
        out += _pad(a.tobytes())
    path.write_bytes(bytes(out))
    return hashlib.sha256(out).hexdigest()


def simplify(coords, tolerance_m: float):
    if len(coords) <= 2 or tolerance_m <= 0:
        return coords
    return list(LineString(coords).simplify(metres_to_deg(tolerance_m), preserve_topology=False).coords)


def export(segments: list[Segment], out_dir: Path, *, region: str, osm_timestamp: str = "", countries: list[str] | None = None,
           pois: list[dict] | None = None, simplify_m: float = 5.0, sea: bool = False) -> dict:
    out_dir.mkdir(parents=True, exist_ok=True)
    node_index: dict[int, int] = {}
    node_coords: list[tuple[float, float]] = []

    def idx(n: int, c) -> int:
        i = node_index.get(n)
        if i is None:
            i = node_index[n] = len(node_coords)
            node_coords.append(c)
        return i

    names = [""]
    name_index: dict[str, int] = {"": 0}
    attrs: list[tuple[float, float, float, float]] = [(0.0, 0.0, 0.0, 0.0)]
    attr_index = {attrs[0]: 0}

    edges: list[tuple[int, int, float, int, int, int]] = []  # from, to, length, geom, attr, flags
    geom_from, geom_to, geom_offsets, lat, lon, geom_name = [], [], [0], [], [], []

    for g, s in enumerate(segments):
        a, b = idx(s.a, s.coords[0]), idx(s.b, s.coords[-1])
        coords = simplify(s.coords, simplify_m)
        for x, y in coords:
            lon.append(round(x * SCALE))
            lat.append(round(y * SCALE))
        geom_from.append(a)
        geom_to.append(b)
        geom_offsets.append(len(lat))
        if s.name not in name_index:
            name_index[s.name] = len(names)
            names.append(s.name)
        geom_name.append(name_index[s.name])
        t = s.limits.as_tuple()
        if t not in attr_index:
            if len(attrs) >= MAX_ATTRS:
                log.warning("attribute table full, dropping limits %s", t)
                t = attrs[0]
            else:
                attr_index[t] = len(attrs)
                attrs.append(t)
        attr = attr_index[t]
        base = (LOCK if s.lock else 0) | (LAKE if s.kind in ("lake", "bridge") else 0) | (CANAL if s.kind == "canal" else 0) \
            | (SEA if s.kind == "sea" else 0) | (PATCH if s.kind in ("patch", "connector") else 0)
        length = s.length
        edges.append((a, b, length, g, attr, base | (DOWNSTREAM if s.flows else 0)))
        if not s.oneway:
            edges.append((b, a, length, g, attr, base | GEOM_REVERSED | (UPSTREAM if s.flows else 0)))

    edges.sort(key=lambda e: e[0])
    n, m = len(node_coords), len(edges)
    offsets = np.zeros(n + 1, dtype="<u4")
    if m:
        np.add.at(offsets, np.array([e[0] for e in edges]) + 1, 1)
    offsets = np.cumsum(offsets, dtype=np.uint64).astype("<u4")
    nc = np.array(node_coords, dtype=float).reshape(-1, 2)

    graph_sha = _write(out_dir / "graph.bin", b"IWG1", [n, m, len(attrs)], [
        np.round(nc[:, 1] * SCALE).astype("<i4"),
        np.round(nc[:, 0] * SCALE).astype("<i4"),
        offsets,
        np.array([e[1] for e in edges], dtype="<u4"),
        np.array([e[2] for e in edges], dtype="<f4"),
        np.array([e[3] for e in edges], dtype="<u4"),
        np.array([e[4] for e in edges], dtype="<u2"),
        np.array([e[5] for e in edges], dtype="<u2"),
        np.array(attrs, dtype="<f4").reshape(-1),
    ])
    geom_sha = _write(out_dir / "geom.bin", b"IWS1", [len(segments), len(lat)], [
        np.array(geom_from, dtype="<u4"), np.array(geom_to, dtype="<u4"), np.array(geom_offsets, dtype="<u4"),
        np.array(lat, dtype="<i4"), np.array(lon, dtype="<i4"), np.array(geom_name, dtype="<u4"),
    ])
    (out_dir / "pois.json").write_text(json.dumps(pois or [], ensure_ascii=False), encoding="utf-8")
    manifest = {
        "version": 1,
        "region": region,
        "countries": countries or [],
        "sea": sea,
        "osmTimestamp": osm_timestamp,
        "built": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "files": {"graph": "graph.bin", "geom": "geom.bin", "pois": "pois.json"},
        "sha256": {"graph": graph_sha, "geom": geom_sha},
        "stats": {"nodes": n, "edges": m, "segments": len(segments), "points": len(lat)},
        "names": names,
        "attribution": "© OpenStreetMap contributors, ODbL",
    }
    (out_dir / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1), encoding="utf-8")
    log.info("exported %d nodes, %d edges, %d points to %s", n, m, len(lat), out_dir)
    return manifest
