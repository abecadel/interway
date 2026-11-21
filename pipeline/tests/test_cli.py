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
from interway_pipeline.cli import apply_patches, main, merge_extracts, promote_ways, read_cached
from interway_pipeline.extract import Extract, Lake, NavWay
from interway_pipeline.model import Segment, metres_to_deg


def navway(wid):
    return NavWay(wid, [wid, wid + 1], [(0.0, 0.0), (0.0, 0.01)], {"kind": "canal"})


# --- promote_ways ------------------------------------------------------------------------------------------

def test_promote_ways_moves_allowlisted_connectors(caplog):
    ex = Extract(ways=[navway(1)], connectors=[navway(10), navway(11)])
    assert promote_ways(ex, set()) == 0
    with caplog.at_level(logging.WARNING):
        assert promote_ways(ex, {1, 11, 99}) == 1
    assert [w.id for w in ex.ways] == [1, 11] and [w.id for w in ex.connectors] == [10]
    assert "[99]" in caplog.text  # 1 is navigable already: not reported
    caplog.clear()
    with caplog.at_level(logging.WARNING):
        assert promote_ways(ex, {10}) == 1
    assert caplog.text == ""


# --- merge_extracts ---------------------------------------------------------------------------------------

def test_merge_single_extract_is_returned_as_is():
    ex = Extract()
    assert merge_extracts([ex]) is ex


def test_merge_deduplicates_overlapping_extracts():
    bridge = (LineString([(0, 0), (1, 1)]), 4.0)
    lake = Lake(7, "Jezioro", box(0, 0, 1, 1), False)
    a = Extract(ways=[navway(1), navway(2)], connectors=[navway(10)], lakes=[lake], lock_nodes={1}, barrier_nodes={5},
                lock_names={1: "A"}, bridges=[bridge], marinas=[("Port", (0.5, 0.5))], timestamp="2026-10-01T00:00:00Z",
                services=[("fuel", "Stacja", (0.5, 0.5))], lock_areas=[("A", box(0, 0, 1, 1))])
    b = Extract(ways=[navway(2), navway(3)], connectors=[navway(10), navway(11), navway(1)],
                lakes=[lake, Lake(8, "Inne", box(2, 2, 3, 3), True)], lock_nodes={2}, barrier_nodes={6},
                lock_names={2: "B"}, bridges=[(LineString([(0, 0), (1, 1)]), 4.0), (LineString([(0, 0), (1, 1)]), 3.0)],
                marinas=[("Port", (0.5, 0.5)), ("Port", (0.6, 0.5))], timestamp="2026-11-01T00:00:00Z",
                services=[("fuel", "Stacja", (0.5, 0.5)), ("water", "", (0.7, 0.5))],
                lock_areas=[("A", box(0, 0, 1, 1)), ("B", box(2, 2, 3, 3))])
    ex = merge_extracts([a, b])
    assert [w.id for w in ex.ways] == [1, 2, 3]
    assert [w.id for w in ex.connectors] == [10, 11]  # way ids are unique across ways and connectors
    assert [lk.id for lk in ex.lakes] == [7, 8]
    assert ex.lock_nodes == {1, 2} and ex.barrier_nodes == {5, 6} and ex.lock_names == {1: "A", 2: "B"}
    assert [h for _, h in ex.bridges] == [4.0, 3.0]
    assert ex.marinas == [("Port", (0.5, 0.5)), ("Port", (0.6, 0.5))]
    assert ex.services == [("fuel", "Stacja", (0.5, 0.5)), ("water", "", (0.7, 0.5))]
    assert [n for n, _ in ex.lock_areas] == ["A", "B"]
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
        feature([[0.015, -0.001], [0.015, 0.001]], name="Jaz", weir=True),  # a weir, not a connector
    ]}), encoding="utf-8")
    (tmp_path / "b.geojson").write_text(json.dumps({"type": "FeatureCollection"}), encoding="utf-8")
    (tmp_path / "notes.txt").write_text("ignored", encoding="utf-8")
    weirs: list = []
    with caplog.at_level(logging.WARNING):
        assert apply_patches(segs, tmp_path, weirs=weirs) == 2
    assert [list(w.coords) for w in weirs] == [[(0.015, -0.001), (0.015, 0.001)]]
    assert apply_patches(segs[:2], tmp_path) == 2  # without a weir list the weir is skipped all the same
    p1, p2 = segs[2:4]
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
          "--min-component-km", "1", "--simplify-m", "0", "--cache", str(tmp_path / "cache"), "-v",
          "--countries", "pl, de,,nl"])
    stats = json.loads(capsys.readouterr().out)
    manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert stats == manifest["stats"] and manifest["region"] == "pl"
    assert manifest["countries"] == ["PL", "DE", "NL"]
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


def test_lift_gap_is_joined_even_inside_a_canal_area(tmp_path):
    # Niederfinow case: the canal stops on both sides of a ship lift (150 m), and canal water areas cover both
    # ends. The facing dead ends must be joined (as a lock) before the river-area mesh turns them into junctions.
    from interway_pipeline.model import LOCK
    d = 0.001
    nodes = {1: (0.0, 0.0), 2: (0.01, 0.0), 3: (0.01 + 0.00135, 0.0), 4: (0.03, 0.0),
             10: (0.009, -d), 11: (0.0125, -d), 12: (0.0125, d), 13: (0.009, d)}
    ways = [(1, [1, 2], {"waterway": "canal", "CEMT": "IV", "name": "Oder-Havel-Kanal"}),
            (2, [3, 4], {"waterway": "canal", "CEMT": "IV", "name": "Oder-Havel-Kanal"}),
            (3, [10, 11, 12, 13, 10], {"natural": "water", "water": "canal"})]
    osm = write_osm(tmp_path / "lift.osm", nodes, ways)
    out = tmp_path / "out"
    cli.build([osm], out, region="t", allowlist=None, patches=None, min_component_km=0.5)
    g = read_graph(out / "graph.bin")
    near = [i for i in range(g["n"]) if abs(g["lon"][i] / 1e7 - 0.01) < 1e-5 or abs(g["lon"][i] / 1e7 - 0.01135) < 1e-5]
    assert len(near) == 2
    a, b = near
    lock_edges = [e for e in range(g["off"][a], g["off"][a + 1]) if g["tgt"][e] == b and g["flags"][e] & LOCK]
    assert lock_edges  # joined, and routed like a lock


def test_patched_gap_gets_no_extra_dead_end_join(tmp_path):
    # Kanał Elbląski case: an inclined plane mapped as a manual patch. The patch must close the gap before
    # the automatic dead-end joins run, otherwise an unnamed parallel join hides the named plane.
    nodes = {1: (0.0, 0.0), 2: (0.01, 0.0), 3: (0.01 + 0.00135, 0.0), 4: (0.03, 0.0)}
    ways = [(1, [1, 2], {"waterway": "canal", "CEMT": "IV", "name": "Kanał"}),
            (2, [3, 4], {"waterway": "canal", "CEMT": "IV", "name": "Kanał"})]
    osm = write_osm(tmp_path / "plane.osm", nodes, ways)
    patches = tmp_path / "patches"
    patches.mkdir()
    (patches / "p.geojson").write_text(json.dumps({"type": "FeatureCollection", "features": [
        {"type": "Feature", "properties": {"name": "Pochylnia", "lock": True},
         "geometry": {"type": "LineString", "coordinates": [[0.01, 0.0], [0.0107, 0.0002], [0.01135, 0.0]]}}]}))
    out = tmp_path / "out"
    cli.build([osm], out, region="t", allowlist=None, patches=patches, min_component_km=0.5)
    g = read_graph(out / "graph.bin")
    near = [i for i in range(g["n"]) if abs(g["lon"][i] / 1e7 - 0.01) < 1e-5 or abs(g["lon"][i] / 1e7 - 0.01135) < 1e-5]
    a, b = near
    assert [g["tgt"][e] for e in range(g["off"][a], g["off"][a + 1])].count(b) == 1


def _land_shapefile(path, polys):
    import shapefile
    with shapefile.Writer(str(path), shapeType=shapefile.POLYGON) as w:
        w.field("id", "N")
        for i, p in enumerate(polys):
            w.poly([list(p.exterior.coords)[::-1]])
            w.record(i)
    return path.with_suffix(".shp")


def test_build_with_sea_routes(tmp_path):
    # a canal on an island (land 0.2..0.45) ending at its east coast, and open sea around it
    nodes = {1: (0.3, 0.5), 2: (0.4499, 0.5)}
    osm = write_osm(tmp_path / "coast.osm", nodes, [(1, [1, 2], {"waterway": "canal", "CEMT": "IV", "name": "Kanał"})])
    land = _land_shapefile(tmp_path / "land", [box(0.2, 0.2, 0.45, 0.8)])
    places = tmp_path / "cities.txt"
    places.write_text("1\tKanałowo\tKanalowo\t\t0.51\t0.31\n2\tDaleko\tDaleko\t\t5.0\t5.0\n", encoding="utf-8")
    cache = tmp_path / "cache"
    for _ in range(2):  # the second build uses the cached mesh
        out = tmp_path / "out"
        m = cli.build([osm], out, region="t", allowlist=None, patches=None, min_component_km=0.5, cache_dir=cache,
                      land=land, sea_bbox=(0.0, 0.0, 1.0, 1.0), places=places)
        pois = json.loads((out / "pois.json").read_text(encoding="utf-8"))
        assert [p["name"] for p in pois if p["type"] == "place"] == ["Kanałowo"]  # 1.5 km away; Daleko is not
        manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
        assert manifest["sea"] is True
        g = read_graph(out / "graph.bin")
        from interway_pipeline.export import SEA
        assert (g["flags"] & SEA).any()
        assert np.any(np.isclose(g["lon"] / 1e7, 0.3))  # the canal is joined to the sea, so it is kept
        assert m["stats"]["edges"] > 10
    assert list(cache.glob("sea.*.pickle"))
    nocache = cli.build([osm], tmp_path / "out2", region="t", allowlist=None, patches=None, min_component_km=0.5,
                        land=land, sea_areas=[{"bbox": (0.0, 0.0, 1.0, 1.0)}])
    assert nocache["stats"]["edges"] == m["stats"]["edges"]
    assert nocache["attribution"] == "© OpenStreetMap contributors, ODbL"


def test_build_with_sea_depth(tmp_path, monkeypatch):
    # the whole test sea is 3 m deep: sea edges get a 2.5 m draft limit, the inland canal none
    nodes = {1: (0.3, 0.5), 2: (0.4499, 0.5)}
    osm = write_osm(tmp_path / "coast.osm", nodes, [(1, [1, 2], {"waterway": "canal", "CEMT": "IV", "name": "Kanał"})])
    land = _land_shapefile(tmp_path / "land", [box(0.2, 0.2, 0.45, 0.8)])
    seen = {}

    def loader(cache_dir, scale):
        seen.update(cache_dir=cache_dir, scale=scale)
        return lambda i, j: np.full((4, 4), -3.0, dtype=np.float32)

    monkeypatch.setattr(cli, "tile_loader", loader)
    m = cli.build([osm], tmp_path / "out", region="t", allowlist=None, patches=None, min_component_km=0.5,
                  land=land, sea_bbox=(0.0, 0.0, 1.0, 1.0), depth_cache=tmp_path / "depth", depth_scale=0.5)
    assert seen == {"cache_dir": tmp_path / "depth", "scale": 0.5}
    assert "EMODnet" in m["attribution"]
    g = read_graph(tmp_path / "out" / "graph.bin")
    from interway_pipeline.export import SEA
    drafts = {round(float(g["attrs"][4 * int(g["attr"][e])]), 2) for e in range(g["m"]) if g["flags"][e] & SEA}
    assert 2.5 in drafts


def test_main_sea_options(tmp_path, monkeypatch):
    seen = {}
    monkeypatch.setattr(cli, "build", lambda *a, **kw: seen.update(kw) or {"stats": {}})
    main(["x.osm", "--land", "land.shp", "--sea-bbox", "1,2,3,4", "--places", "cities.txt", "--depth-cache", "d",
          "--depth-scale", "0.5"])
    assert str(seen["land"]) == "land.shp" and seen["sea_bbox"] == (1.0, 2.0, 3.0, 4.0)
    assert str(seen["places"]) == "cities.txt" and str(seen["depth_cache"]) == "d" and seen["depth_scale"] == 0.5


def test_main_reads_sea_areas(tmp_path, monkeypatch):
    seen = {}
    monkeypatch.setattr(cli, "build", lambda *a, **kw: seen.update(kw) or {"stats": {}})
    areas = tmp_path / "areas.json"
    areas.write_text('[{"name": "a", "bbox": [1, 2, 3, 4]}, {"name": "b", "bbox": [5, 6, 7, 8], "max_offshore_m": 9}]')
    main(["x.osm", "--sea-areas", str(areas)])
    assert seen["sea_areas"][1] == {"name": "b", "bbox": [5, 6, 7, 8], "max_offshore_m": 9}
    main(["x.osm"])
    assert seen["sea_areas"] is None


def test_meshed_lakes_keeps_only_lakes_with_a_mesh():
    from shapely.geometry import box
    meshed = Lake(1, "A", box(0, 0, 1, 1), True)
    bare = Lake(2, "B", box(5, 5, 6, 6), True)
    channel = Lake(3, "C", box(0, 0, 1, 1), True, kind="channel")
    segs = [Segment(a=1, b=2, coords=[(0.2, 0.2), (0.8, 0.8)], kind="lake"),
            Segment(a=3, b=4, coords=[(5.5, 5.5), (5.6, 5.6)], kind="river")]
    assert cli.meshed_lakes([meshed, bare, channel], segs) == [meshed.polygon]
    assert cli.meshed_lakes([], segs) == []
    assert cli.meshed_lakes([meshed], []) == []
