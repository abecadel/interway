"""Readers for graph.bin / geom.bin (docs/graph-format.md), independent of the exporter."""
from __future__ import annotations

from pathlib import Path

import numpy as np


def _read(b: bytes, magic: bytes, nheader: int, fields) -> dict:
    assert b[:4] == magic
    header = [int(x) for x in np.frombuffer(b, "<u4", nheader + 1, 4)]
    assert header[0] == 1  # version
    pos = 8 + 4 * nheader
    out = {}
    for name, dt, cnt in fields(*header[1:]):
        out[name] = np.frombuffer(b, dt, cnt, pos)
        pos += (out[name].nbytes + 3) & ~3
    assert pos == len(b)
    return out, header[1:]


def read_graph(path: Path) -> dict:
    out, (n, m, _a) = _read(path.read_bytes(), b"IWG1", 3, lambda n, m, a: [
        ("lat", "<i4", n), ("lon", "<i4", n), ("off", "<u4", n + 1), ("tgt", "<u4", m), ("len", "<f4", m),
        ("geom", "<u4", m), ("attr", "<u2", m), ("flags", "<u2", m), ("attrs", "<f4", a * 4)])
    out["n"], out["m"] = n, m
    return out


def read_geom(path: Path) -> dict:
    out, (g, p) = _read(path.read_bytes(), b"IWS1", 2, lambda g, p: [
        ("from", "<u4", g), ("to", "<u4", g), ("off", "<u4", g + 1), ("lat", "<i4", p), ("lon", "<i4", p),
        ("name", "<u4", g)])
    out["g"], out["p"] = g, p
    return out


def edges(g: dict) -> list[tuple[int, int, int]]:
    """(from, to, flags) for every directed edge."""
    return [(u, int(g["tgt"][e]), int(g["flags"][e])) for u in range(g["n"]) for e in range(g["off"][u], g["off"][u + 1])]
