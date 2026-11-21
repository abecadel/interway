import hashlib
import json
import logging

import pytest
from graphio import edges, read_geom, read_graph

from interway_pipeline import export as export_mod
from interway_pipeline.export import export, simplify
from interway_pipeline.model import (
    CANAL,
    DOWNSTREAM,
    GEOM_REVERSED,
    LAKE,
    LOCK,
    PATCH,
    SEA,
    UPSTREAM,
    Limits,
    Segment,
    haversine,
    metres_to_deg,
)

K = metres_to_deg(1000)


def seg(a, b, x0, x1, **kw):
    return Segment(a=a, b=b, coords=[(x0 * K, 0.0), (x1 * K, 0.0)], **kw)


def test_simplify():
    line = [(0.0, 0.0), (K, metres_to_deg(1)), (2 * K, 0.0)]
    assert simplify(line, 5) == [(0.0, 0.0), (2 * K, 0.0)]
    assert simplify(line, 0.5) == line
    assert simplify(line, 0) is line
    assert simplify(line[:2], 100) == line[:2]


def test_export_empty(tmp_path):
    m = export([], tmp_path / "out", region="none")
    assert m["stats"] == {"nodes": 0, "edges": 0, "segments": 0, "points": 0}
    g = read_graph(tmp_path / "out" / "graph.bin")
    assert g["n"] == g["m"] == 0 and list(g["off"]) == [0]
    assert read_geom(tmp_path / "out" / "geom.bin")["g"] == 0
    assert json.loads((tmp_path / "out" / "pois.json").read_text()) == []


def test_export_roundtrip(tmp_path):
    segs = [
        seg(1, 2, 0, 1, name="Odra", kind="river", flows=True, limits=Limits(max_draft=1.8)),
        seg(2, 3, 1, 2, name="Kanał", kind="canal", lock=True, limits=Limits(max_draft=1.8)),
        seg(3, 4, 2, 3, kind="lake"),
        seg(4, 5, 3, 4, name="Odra", kind="sea", oneway=True),
        seg(5, 1, 4, 0, kind="patch", limits=Limits(max_height=3)),
        seg(-7, 2, 5, 1, kind="connector"),
    ]
    segs[0].coords.insert(1, (0.5 * K, 0.0))  # collinear point, simplified away
    pois = [{"type": "lock", "name": "Śluza", "lon": 1.0, "lat": 2.0}]
    out = tmp_path / "out"
    m = export(segs, out, region="test", osm_timestamp="2026-11-01T00:00:00Z", pois=pois)

    g, geo = read_graph(out / "graph.bin"), read_geom(out / "geom.bin")
    assert m["stats"] == {"nodes": 6, "edges": 11, "segments": 6, "points": 12}
    assert m["names"] == ["", "Odra", "Kanał"]
    assert m["region"] == "test" and m["osmTimestamp"] == "2026-11-01T00:00:00Z"
    assert m["sha256"]["graph"] == hashlib.sha256((out / "graph.bin").read_bytes()).hexdigest()
    assert m["sha256"]["geom"] == hashlib.sha256((out / "geom.bin").read_bytes()).hexdigest()
    assert json.loads((out / "manifest.json").read_text(encoding="utf-8")) == m
    assert json.loads((out / "pois.json").read_text(encoding="utf-8")) == pois

    # nodes are numbered in order of first use: 1, 2, 3, 4, 5, -7
    assert list(g["lon"]) == [round(x * K * 1e7) for x in (0, 1, 2, 3, 4, 5)]
    assert not g["lat"].any()
    # CSR offsets are monotonic and edges are grouped by source node
    assert list(g["off"]) == sorted(g["off"]) and g["off"][-1] == g["m"]

    by_geom = {}
    for e, (u, v, f) in enumerate(edges(g)):
        by_geom.setdefault(int(g["geom"][e]), []).append((u, v, f, int(g["attr"][e])))
    assert sorted(by_geom[0]) == [(0, 1, DOWNSTREAM, 1), (1, 0, UPSTREAM | GEOM_REVERSED, 1)]
    assert sorted(by_geom[1]) == [(1, 2, CANAL | LOCK, 1), (2, 1, CANAL | LOCK | GEOM_REVERSED, 1)]
    assert sorted(by_geom[2]) == [(2, 3, LAKE, 0), (3, 2, LAKE | GEOM_REVERSED, 0)]
    assert by_geom[3] == [(3, 4, SEA, 0)]  # one-way: a single edge
    assert {f for *_, f, _ in by_geom[4]} == {PATCH, PATCH | GEOM_REVERSED}
    assert {f for *_, f, _ in by_geom[5]} == {PATCH, PATCH | GEOM_REVERSED}
    assert g["attrs"].reshape(-1, 4).tolist() == [[0, 0, 0, 0], [pytest.approx(1.8), 0, 0, 0], [0, 3, 0, 0]]
    lengths = {int(g["geom"][e]): float(g["len"][e]) for e in range(g["m"])}
    assert lengths[0] == pytest.approx(haversine((0, 0), (K, 0)), rel=1e-6)
    assert lengths[4] == pytest.approx(4 * lengths[0], rel=1e-6)

    assert list(geo["from"]) == [0, 1, 2, 3, 4, 5] and list(geo["to"]) == [1, 2, 3, 4, 0, 1]
    assert list(geo["off"]) == [0, 2, 4, 6, 8, 10, 12]  # the collinear point is gone
    assert list(geo["name"]) == [1, 2, 0, 1, 0, 0]


def test_attribute_table_overflow(tmp_path, monkeypatch, caplog):
    monkeypatch.setattr(export_mod, "MAX_ATTRS", 3)
    segs = [seg(i, i + 1, i, i + 1, limits=Limits(max_draft=float(i))) for i in range(1, 5)]
    with caplog.at_level(logging.WARNING):
        export(segs, tmp_path, region="t")
    g = read_graph(tmp_path / "graph.bin")
    assert g["attrs"].reshape(-1, 4)[:, 0].tolist() == [0, 1, 2]
    attr_by_geom = {int(g["geom"][e]): int(g["attr"][e]) for e in range(g["m"])}
    assert attr_by_geom == {0: 1, 1: 2, 2: 0, 3: 0}  # rows that do not fit fall back to "no restrictions"
    assert "attribute table full" in caplog.text


def test_sea_without_charted_depth_is_flagged(tmp_path):
    from interway_pipeline.model import NO_DEPTH
    segs = [Segment(a=1, b=2, coords=[(0, 0), (0.1, 0)], kind="sea", depth_unknown=True),
            Segment(a=2, b=3, coords=[(0.1, 0), (0.2, 0)], kind="sea")]
    export(segs, tmp_path, region="t")
    g = read_graph(tmp_path / "graph.bin")
    flags = {(u, v): f for u, v, f in edges(g)}
    assert flags[(0, 1)] & NO_DEPTH and flags[(1, 0)] & NO_DEPTH
    assert not flags[(1, 2)] & NO_DEPTH and all(f & SEA for f in flags.values())
