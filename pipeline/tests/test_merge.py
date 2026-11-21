import json
import runpy
import sys

import pytest
from fixture import NODE_TAGS, NODES, WAYS, write_osm
from graphio import edges, read_geom, read_graph

from interway_pipeline import cli, merge

WEST = -100.0  # the second region lies far to the west, as North America does


@pytest.fixture(scope="module")
def regions(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("regions")
    allow = tmp / "allow"
    allow.mkdir()
    (allow / "a.yaml").write_text("waterways: [Narew]\n", encoding="utf-8")
    eu = write_osm(tmp / "eu.osm", {**NODES, 900: (20.045, 52.0)}, WAYS,
                   node_tags={**NODE_TAGS, 900: {"leisure": "marina", "name": "Przystań"}})
    # the same network shifted west, with its own names and limits
    na_nodes = {k: (v[0] + WEST, v[1]) for k, v in NODES.items()}
    na_ways = [(w, n, {**t, "name": t["name"] + " West"} if "name" in t else t) for w, n, t in WAYS]
    na_ways.append((400, [7, 8, 9], {"waterway": "canal", "name": "Kanał Testowy West", "CEMT": "II", "maxdraft": "1.4"}))
    na = write_osm(tmp / "na.osm", na_nodes, na_ways, node_tags=NODE_TAGS)
    a, b = tmp / "a", tmp / "b"
    ma = cli.build([eu], a, region="Europe", allowlist=allow, patches=None, min_component_km=0.5, countries=["PL"])
    mb = cli.build([na], b, region="North America", allowlist=allow, patches=None, min_component_km=0.5, countries=["US"])
    out = tmp / "merged"
    m = merge.merge([a, b], out, "Europe + North America")
    return a, b, out, ma, mb, m


def test_merged_pack_is_the_regions_side_by_side(regions):
    a, b, out, ma, mb, m = regions
    ga, gb, g = read_graph(a / "graph.bin"), read_graph(b / "graph.bin"), read_graph(out / "graph.bin")
    sa, sb, s = read_geom(a / "geom.bin"), read_geom(b / "geom.bin"), read_geom(out / "geom.bin")
    assert (g["n"], g["m"]) == (ga["n"] + gb["n"], ga["m"] + gb["m"])
    assert (s["g"], s["p"]) == (sa["g"] + sb["g"], sa["p"] + sb["p"])
    # edges of the first region unchanged, the second's shifted by the first's node count
    n = ga["n"]
    assert edges(g) == edges(ga) + [(u + n, v + n, f) for u, v, f in edges(gb)]
    assert list(g["lon"][n:]) == list(gb["lon"]) and (g["lon"][n:] < 0).all()
    assert list(s["from"][sa["g"]:]) == [x + n for x in sb["from"]]
    assert list(s["off"]) == list(sa["off"][:-1]) + [x + sa["p"] for x in sb["off"]]
    assert list(g["geom"][ga["m"]:]) == [x + sa["g"] for x in gb["geom"]]
    # names and limits survive the merge of their tables
    names = m["names"]
    assert names[0] == "" and len(names) == len(set(names))
    assert [names[i] for i in s["name"][sa["g"]:]] == [mb["names"][i] for i in sb["name"]]
    rows = g["attrs"].reshape(-1, 4)
    rows_b = gb["attrs"].reshape(-1, 4)
    assert [tuple(rows[i]) for i in g["attr"][ga["m"]:]] == [tuple(rows_b[i]) for i in gb["attr"]]
    assert any(abs(r[0] - 1.4) < 1e-6 for r in rows)


def test_merged_manifest(regions):
    a, b, out, ma, mb, m = regions
    on_disk = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
    assert on_disk == m
    assert m["region"] == "Europe + North America" and m["regions"] == ["Europe", "North America"]
    assert m["countries"] == ["PL", "US"] and m["sea"] is False
    assert m["attribution"] == "© OpenStreetMap contributors, ODbL"
    assert m["stats"]["nodes"] == ma["stats"]["nodes"] + mb["stats"]["nodes"]
    assert json.loads((out / "pois.json").read_text(encoding="utf-8")) == json.loads((a / "pois.json").read_text()) + json.loads(
        (b / "pois.json").read_text())


def test_attributions_are_joined_once(tmp_path, regions):
    a, b, *_ = regions
    for d, extra in ((a, "towns © GeoNames, CC BY 4.0"), (b, "Bathymetry © EMODnet")):
        man = json.loads((d / "manifest.json").read_text())
        man["attribution"] = f"© OpenStreetMap contributors, ODbL · {extra}"
        (tmp_path / d.name).mkdir()
        for f in ("graph.bin", "geom.bin"):
            (tmp_path / d.name / f).write_bytes((d / f).read_bytes())
        (tmp_path / d.name / "manifest.json").write_text(json.dumps({**man, "sea": d is b}))
    m = merge.merge([tmp_path / a.name, tmp_path / b.name], tmp_path / "o", "x")
    assert m["attribution"] == "© OpenStreetMap contributors, ODbL · towns © GeoNames, CC BY 4.0 · Bathymetry © EMODnet"
    assert m["sea"] is True and json.loads((tmp_path / "o" / "pois.json").read_text()) == []  # no pois files here


def test_bad_inputs_are_refused(tmp_path, regions, monkeypatch):
    a, b, *_ = regions
    bad = tmp_path / "bad"
    bad.mkdir()
    (bad / "manifest.json").write_text(json.dumps({"files": {"graph": "graph.bin", "geom": "geom.bin"}, "names": [""]}))
    (bad / "graph.bin").write_bytes(b"XXXX" + bytes(16))
    with pytest.raises(ValueError, match="not an Interway file"):
        merge.read_pack(bad)
    (bad / "graph.bin").write_bytes(b"IWG1" + (2).to_bytes(4, "little") + bytes(12))
    with pytest.raises(ValueError, match="unsupported version"):
        merge.read_pack(bad)
    monkeypatch.setattr(merge, "MAX_ATTRS", 1)
    with pytest.raises(ValueError, match="attribute table full"):
        merge.merge([a, b], tmp_path / "o1", "x")
    monkeypatch.setattr(merge, "MAX_ATTRS", 65535)
    monkeypatch.setattr(merge, "INDEX_LIMIT", 10)
    with pytest.raises(ValueError, match="too large"):
        merge.merge([a, b], tmp_path / "o2", "x")


@pytest.mark.filterwarnings("ignore::RuntimeWarning")  # runpy warns that the module is already imported
def test_command_line(tmp_path, regions, monkeypatch, capsys):
    a, b, *_ = regions
    monkeypatch.setattr(sys, "argv", ["interway-merge", str(a), str(b), "-o", str(tmp_path / "m"), "--region", "Both"])
    runpy.run_module("interway_pipeline.merge", run_name="__main__")
    stats = json.loads(capsys.readouterr().out)
    assert stats["nodes"] == json.loads((tmp_path / "m" / "manifest.json").read_text())["stats"]["nodes"]
