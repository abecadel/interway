import json
import logging
import runpy
import sys

import numpy as np
import pytest
from fixture import NODE_TAGS, NODES, WAYS, write_fixture, write_osm
from graphio import read_graph
from shapely.geometry import LineString, box

from interway_pipeline import cli
from interway_pipeline.classify import Allowlist
from interway_pipeline.cli import apply_patches, main, merge_extracts, read_cached
from interway_pipeline.extract import Extract, Lake, NavWay
from interway_pipeline.model import Segment, metres_to_deg


def navway(wid):
    return NavWay(wid, [wid, wid + 1], [(0.0, 0.0), (0.0, 0.01)], {"kind": "canal"})


# --- merge_extracts ---------------------------------------------------------------------------------------

def test_merge_single_extract_is_returned_as_is():
    ex = Extract()
    assert merge_extracts([ex]) is ex


def test_merge_deduplicates_overlapping_extracts():
    bridge = (LineString([(0, 0), (1, 1)]), 4.0)
    lake = Lake(7, "Jezioro", box(0, 0, 1, 1), False)
    a = Extract(ways=[navway(1), navway(2)], connectors=[navway(10)], lakes=[lake], lock_nodes={1}, barrier_nodes={5},
                lock_names={1: "A"}, bridges=[bridge], marinas=[("Port", (0.5, 0.5))], timestamp="2026-10-01T00:00:00Z")
    b = Extract(ways=[navway(2), navway(3)], connectors=[navway(10), navway(11), navway(1)],
                lakes=[lake, Lake(8, "Inne", box(2, 2, 3, 3), True)], lock_nodes={2}, barrier_nodes={6},
                lock_names={2: "B"}, bridges=[(LineString([(0, 0), (1, 1)]), 4.0), (LineString([(0, 0), (1, 1)]), 3.0)],
                marinas=[("Port", (0.5, 0.5)), ("Port", (0.6, 0.5))], timestamp="2026-11-01T00:00:00Z")
    ex = merge_extracts([a, b])
    assert [w.id for w in ex.ways] == [1, 2, 3]
    assert [w.id for w in ex.connectors] == [10, 11]  # way ids are unique across ways and connectors
    assert [lk.id for lk in ex.lakes] == [7, 8]
    assert ex.lock_nodes == {1, 2} and ex.barrier_nodes == {5, 6} and ex.lock_names == {1: "A", 2: "B"}
    assert [h for _, h in ex.bridges] == [4.0, 3.0]
    assert ex.marinas == [("Port", (0.5, 0.5)), ("Port", (0.6, 0.5))]
    assert ex.timestamp == "2026-11-01T00:00:00Z"


# --- apply_patches ----------------------------------------------------------------------------------------

def line(a, b, x0, x1):
    return Segment(a=a, b=b, coords=[(x0, 0.0), (x1, 0.0)], kind="canal")


def feature(coords, geometry_type="LineString", **props):
    return {"type": "Feature", "properties": props or None, "geometry": {"type": geometry_type, "coordinates": coords}}


def test_patches_missing(tmp_path):
    assert apply_patches([line(1, 2, 0, 0.01)], None) == 0
    assert apply_patches([line(1, 2, 0, 0.01)], tmp_path / "missing") == 0
    (tmp_path / "p.geojson").write_text(json.dumps({"features": [feature([[0, 0], [1, 0]])]}), encoding="utf-8")
    assert apply_patches([], tmp_path) == 0  # nothing to snap to


def test_patches_snap_to_network(tmp_path, caplog):
    m = metres_to_deg(1)
    segs = [line(1, 2, 0, 0.01), line(3, 4, 0.02, 0.03)]
    (tmp_path / "a.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
        feature([[0.01 + 50 * m, 20 * m], [0.015, 0.001], [0.02 - 100 * m, 0]], name="Przekop", lock=True),
        feature([[0.01, 0], [0.02, 0]]),
        feature([0.0, 0.0], "Point", name="Not a line"),
        {"type": "Feature", "properties": {"name": "no geometry"}, "geometry": None},
        feature([[0.03, 0], [0.03, 0.01]], name="Far"),  # 1.1 km from any node
        feature([[0.0, 0.0], [0.0, 10 * m]], name="Loop"),  # both ends snap to node 1
    ]}), encoding="utf-8")
    (tmp_path / "b.geojson").write_text(json.dumps({"type": "FeatureCollection"}), encoding="utf-8")
    (tmp_path / "notes.txt").write_text("ignored", encoding="utf-8")
    with caplog.at_level(logging.WARNING):
        assert apply_patches(segs, tmp_path) == 2
    p1, p2 = segs[2:]
    assert (p1.a, p1.b, p1.name, p1.lock, p1.kind) == (2, 3, "Przekop", True, "patch")
    assert p1.coords == [(0.01, 0.0), (0.015, 0.001), (0.02, 0.0)]  # ends moved onto the nodes
    assert (p2.a, p2.b, p2.name, p2.lock) == (2, 3, "", False)
    assert "'Far'" in caplog.text and "a.geojson" in caplog.text
    assert "'Loop'" in caplog.text and "same node" in caplog.text


# --- read_cached ------------------------------------------------------------------------------------------

@pytest.fixture
def osm(tmp_path):
    return write_fixture(tmp_path / "fixture.osm")


def counting_reader(monkeypatch):
    calls = []
    real = cli.read_osm

    def read(path, allow):
        calls.append(path)
        return real(path, allow)

    monkeypatch.setattr(cli, "read_osm", read)
    return calls


def test_read_cached_without_cache(osm, monkeypatch):
    calls = counting_reader(monkeypatch)
    read_cached(osm, Allowlist(), None)
    read_cached(osm, Allowlist(), None)
    assert len(calls) == 2


def test_read_cached_miss_then_hit(osm, tmp_path, monkeypatch):
    calls = counting_reader(monkeypatch)
    cache = tmp_path / "cache" / "nested"
    allow = Allowlist(names={"narew"})
    first = read_cached(osm, allow, cache)
    assert len(calls) == 1 and len(list(cache.glob("fixture.osm.*.pickle"))) == 1
    second = read_cached(osm, allow, cache)
    assert len(calls) == 1  # served from the cache
    assert second == first
    read_cached(osm, Allowlist(names={"odra"}), cache)  # another allowlist is another key
    assert len(calls) == 2 and len(list(cache.glob("*.pickle"))) == 2


# --- build / main -----------------------------------------------------------------------------------------

@pytest.fixture
def inputs(tmp_path):
    allow = tmp_path / "allow"
    allow.mkdir()
    (allow / "pl.yaml").write_text("waterways: [Narew]\n", encoding="utf-8")
    nodes = {**NODES, 900: (20.045, 52.0), 901: (25.0, 55.0)}
    tags = {**NODE_TAGS, 900: {"leisure": "marina", "name": "Przystań"}, 901: {"leisure": "marina", "name": "Daleko"}}
    osm = write_osm(tmp_path / "region.osm", nodes, WAYS, node_tags=tags)
    patches = tmp_path / "patches"
    patches.mkdir()
    # reconnect the river stretch behind the weir (node 11) to the canal end (node 9)
    (patches / "weir.geojson").write_text(json.dumps({"features": [
        feature([list(NODES[9]), list(NODES[11])], name="Obejście jazu")]}), encoding="utf-8")
    return osm, allow, patches


def test_main(inputs, tmp_path, capsys):
    osm, allow, patches = inputs
    out = tmp_path / "out"
    main([str(osm), "-o", str(out), "--region", "pl", "--allowlist", str(allow), "--patches", str(patches),
          "--min-component-km", "1", "--simplify-m", "0", "--cache", str(tmp_path / "cache"), "-v"])
    stats = json.loads(capsys.readouterr().out)
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert stats == manifest["stats"] and manifest["region"] == "pl"
    assert "Obejście jazu" in manifest["names"]
    g = read_graph(out / "graph.bin")
    assert np.any(np.isclose(g["lon"] / 1e7, 20.11))  # kept thanks to the patch
    pois = json.loads((out / "pois.json").read_text(encoding="utf-8"))
    assert [p["name"] for p in pois if p["type"] == "marina"] == ["Przystań"]  # "Daleko" is off the network
    assert [p["name"] for p in pois if p["type"] == "lock"] == ["Śluza Testowa"]
    qa = json.loads((out / "qa-components.json").read_text(encoding="utf-8"))
    assert qa[0]["length_m"] >= qa[-1]["length_m"]
    assert list((tmp_path / "cache").glob("*.pickle"))


def test_build_without_network(tmp_path):
    osm = write_osm(tmp_path / "empty.osm", {1: (20.0, 52.0)}, [], node_tags={1: {"leisure": "marina"}})
    m = cli.build([osm], tmp_path / "out", region="x", allowlist=None, patches=None)
    assert m["stats"]["edges"] == 0
    assert json.loads((tmp_path / "out" / "pois.json").read_text()) == []


@pytest.mark.filterwarnings("ignore::RuntimeWarning")  # runpy warns that the module is already imported
def test_module_entry_point(inputs, tmp_path, monkeypatch, capsys):
    osm, allow, _ = inputs
    monkeypatch.setattr(sys, "argv", ["interway-build", str(osm), "-o", str(tmp_path / "o"), "--allowlist", str(allow),
                                      "--patches", str(tmp_path / "none")])
    runpy.run_module("interway_pipeline.cli", run_name="__main__")
    assert json.loads(capsys.readouterr().out)["edges"] > 0
