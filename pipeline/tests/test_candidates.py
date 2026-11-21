import json
import runpy
import sys

import pytest
from fixture import write_osm

from interway_pipeline.candidates import Candidate, main, scan
from interway_pipeline.classify import Allowlist

NODES = {
    # navigable canal (CEMT) 1-2-3
    1: (20.00, 52.00), 2: (20.01, 52.00), 3: (20.02, 52.00),
    # "Kanał Boczny" leaves the canal at 3 with a lock gate at 4 (two ways)
    4: (20.02, 52.01), 5: (20.02, 52.02), 6: (20.02, 52.03),
    # "Rzeka Łodzi": boat=yes, far from everything
    10: (21.00, 53.00), 11: (21.00, 53.02),
    # "Rzeczka": a plain named river with a marina next to it (and a marina area way)
    20: (22.00, 54.00), 21: (22.00, 54.02), 22: (22.0005, 54.01), 23: (22.0006, 54.011), 24: (22.0007, 54.01),
    # "Strumień": no sign of boats; "Bez nazwy" unnamed; "Zakaz" boat=no
    30: (23.00, 55.00), 31: (23.00, 55.01), 32: (23.1, 55.0), 33: (23.1, 55.01),
    # a way cut at the extract's border (node 99 has no location)
    40: (24.0, 56.0),
}
ONE_CANAL = [(1, [1, 2], {"waterway": "canal", "name": "A", "boat": "yes"})]
NODE_TAGS = {4: {"waterway": "lock_gate"}, 22: {"leisure": "marina", "name": "Przystań"}}
WAYS = [
    (1, [1, 2, 3], {"waterway": "canal", "name": "Kanał Główny", "CEMT": "IV"}),
    (2, [3, 4, 5], {"waterway": "canal", "name": "Kanał Boczny"}),
    (3, [5, 6], {"waterway": "canal", "name": "Kanał Boczny"}),
    (4, [10, 11], {"waterway": "river", "name": "Rzeka Łodzi", "boat": "yes"}),
    (5, [20, 21], {"waterway": "river", "name": "Rzeczka"}),
    (6, [23, 24, 22, 23], {"leisure": "slipway"}),
    (7, [30, 31], {"waterway": "river", "name": "Strumień"}),
    (8, [32, 33], {"waterway": "river"}),
    (9, [32, 33], {"waterway": "river", "name": "Zakaz", "boat": "no", "motorboat": "no"}),
    (10, [40, 99], {"waterway": "river", "name": "Ucięta", "boat": "yes"}),
    (11, [99, 40], {"leisure": "marina"}),
]


def test_scan_finds_rivers_and_canals_with_signs_of_boats(tmp_path):
    # a relation is read too (and ignored)
    osm = write_osm(tmp_path / "poland.filtered.osm", NODES, WAYS, [(1, [("way", 1, "")], {"type": "waterway"})],
                    node_tags=NODE_TAGS)
    found = {c.name: c for c in scan(osm, Allowlist())}
    assert list(found) == ["Kanał Boczny", "Rzeka Łodzi", "Rzeczka"]  # best first
    side = found["Kanał Boczny"]
    assert side.source == "poland" and len(side.lines) == 2 and side.locks == 1 and side.junctions == 1
    assert 3.2 < side.km < 3.4 and side.score == round(side.km * 3, 1)
    assert found["Rzeka Łodzi"].boat == 1 and found["Rzeka Łodzi"].harbours == 0
    assert found["Rzeczka"].harbours == 1 and found["Rzeczka"].boat == 0
    # allowlisted names are already in the network
    assert "Kanał Boczny" not in {c.name for c in scan(osm, Allowlist(names={"kanał boczny"}))}


def test_scan_without_harbours(tmp_path):
    osm = write_osm(tmp_path / "x.osm", {1: (0, 0), 2: (0, 0.01)}, ONE_CANAL)
    assert [c.name for c in scan(osm, Allowlist())] == ["A"]
    assert Candidate("B", "x").score == 0


def test_main_writes_the_report(tmp_path, capsys):
    osm = write_osm(tmp_path / "poland.filtered.osm", NODES, WAYS, node_tags=NODE_TAGS)
    out = tmp_path / "candidates.geojson"
    main([str(osm), "--allowlist", str(tmp_path / "none"), "-o", str(out), "--top", "1"])
    fc = json.loads(out.read_text())
    assert [f["properties"]["name"] for f in fc["features"]] == ["Kanał Boczny", "Rzeka Łodzi", "Rzeczka"]
    assert fc["features"][0]["geometry"]["type"] == "MultiLineString"
    printed = capsys.readouterr().out.strip().splitlines()
    assert len(printed) == 1 and printed[0].startswith("poland\t") and printed[0].endswith("Kanał Boczny")


@pytest.mark.filterwarnings("ignore::RuntimeWarning")  # runpy warns that the module is already imported
def test_runs_as_a_module(tmp_path, monkeypatch):
    osm = write_osm(tmp_path / "x.osm", {1: (0, 0), 2: (0, 0.01)}, ONE_CANAL)
    monkeypatch.setattr(sys, "argv", ["interway-candidates", str(osm), "-o", str(tmp_path / "c.geojson")])
    runpy.run_module("interway_pipeline.candidates", run_name="__main__")
    assert (tmp_path / "c.geojson").exists()
