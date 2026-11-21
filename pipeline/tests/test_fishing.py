import json
import runpy
import sys

import pytest
from fixture import NODE_TAGS, NODES, WAYS, write_osm

from interway_pipeline import cli, fishing
from interway_pipeline.pois import poi_type


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("fish")
    allow = tmp / "allow"
    allow.mkdir()
    (allow / "a.yaml").write_text("waterways: [Narew]\n", encoding="utf-8")
    src = write_osm(tmp / "net.osm", NODES, WAYS, node_tags=NODE_TAGS)
    out = tmp / "data"
    cli.build([src], out, region="T", allowlist=allow, patches=None, min_component_km=0.5, countries=["PL"])
    extra_nodes = {
        900: (20.015, 52.005), 901: (20.02, 52.02), 902: (20.05, 52.0), 903: (20.07, 52.001), 904: (20.5, 52.5),
        910: (20.07, 51.995), 911: (20.08, 51.995), 912: (20.08, 51.998), 913: (20.07, 51.998),
        905: (20.03, 52.0), 906: None,  # a marina (not a fishing place), a node without a location
        920: (20.2, 51.9), 921: (20.2, 51.9001),  # a degenerate fish farm area
    }
    extra_tags = {
        900: {"leisure": "fishing", "name": "Stanowisko"},
        901: {"shop": "fishing", "name": "Wędkarz", "website": "https://wedkarz.example", "opening_hours": "Mo-Sa 08-18"},
        902: {"seamark:type": "wreck", "depth": "4"},
        903: {"seamark:type": "obstruction"},
        904: {"leisure": "fishing", "name": "Too far"},
        905: {"leisure": "marina"},
        906: {"leisure": "fishing"},
    }
    farm = [(950, [910, 911, 912, 913, 910], {"landuse": "aquaculture", "name": "Hodowla"}),
            (951, [920, 921, 920], {"landuse": "aquaculture"})]
    fish = write_osm(tmp / "fish.osm", extra_nodes, farm, node_tags=extra_tags)
    return out, fish


def test_fishing_kinds():
    assert poi_type({"leisure": "fishing"}) == "fishing"
    assert poi_type({"shop": "fishing"}) == "tackle"
    assert poi_type({"seamark:type": "wreck"}) == "wreck"
    assert poi_type({"seamark:type": "obstruction"}) == "obstruction"
    assert poi_type({"seamark:type": "marine_farm"}) == "fishfarm"
    assert poi_type({"landuse": "aquaculture"}) == "fishfarm"


def test_adds_fishing_places_near_the_network(built):
    out, fish = built
    before = json.loads((out / "pois.json").read_text())
    counts = fishing.add_fishing(out, [fish])
    assert counts == {"fishing": 1, "tackle": 1, "wreck": 1, "obstruction": 1, "fishfarm": 1}
    pois = json.loads((out / "pois.json").read_text())
    assert pois[:len(before)] == before  # what was there stays
    shop = next(p for p in pois if p["type"] == "tackle")
    assert shop == {"type": "tackle", "name": "Wędkarz", "lon": 20.02, "lat": 52.02, "website": "https://wedkarz.example",
                    "hours": "Mo-Sa 08-18"}
    assert next(p for p in pois if p["type"] == "wreck")["depth"] == "4"
    farm = next(p for p in pois if p["type"] == "fishfarm")
    assert 20.07 < farm["lon"] < 20.08 and 51.995 < farm["lat"] < 51.998
    assert not any(p["name"] == "Too far" for p in pois)
    # run again (the same file twice: each place once): the fishing places are replaced, not added twice
    fishing.add_fishing(out, [fish, fish])
    assert len(json.loads((out / "pois.json").read_text())) == len(pois)


def test_a_pack_without_pois_gets_them(tmp_path, built):
    out, fish = built
    for f in ("graph.bin", "geom.bin"):
        (tmp_path / f).write_bytes((out / f).read_bytes())
    man = json.loads((out / "manifest.json").read_text())
    del man["files"]["pois"]
    (tmp_path / "manifest.json").write_text(json.dumps(man))
    fishing.add_fishing(tmp_path, [fish])
    assert json.loads((tmp_path / "manifest.json").read_text())["files"]["pois"] == "pois.json"
    assert len(json.loads((tmp_path / "pois.json").read_text())) == 5
    assert fishing.near_network([], []) == []


@pytest.mark.filterwarnings("ignore::RuntimeWarning")
def test_command_line(built, monkeypatch, capsys):
    out, fish = built
    monkeypatch.setattr(sys, "argv", ["interway-fishing-pois", str(out), str(fish)])
    runpy.run_module("interway_pipeline.fishing", run_name="__main__")
    assert json.loads(capsys.readouterr().out)["tackle"] == 1


def test_an_area_without_a_shape_is_skipped(built, monkeypatch):
    _, fish = built
    monkeypatch.setattr(fishing, "_area_polygon", lambda o: None)
    assert not any(p["type"] == "fishfarm" for p in fishing.read_fishing([fish]))
