import runpy
import sys

import osmium
import pytest
from fixture import write_osm

from interway_pipeline.prefilter import main, prefilter


def contents(path):
    out = {"n": set(), "w": {}, "r": set()}
    for o in osmium.FileProcessor(str(path)):
        if o.is_node():
            out["n"].add(o.id)
        elif o.is_way():
            out["w"][o.id] = dict(o.tags)
        else:
            out["r"].add(o.id)
    return out


@pytest.fixture
def src(tmp_path):
    nodes = {i: (20 + i / 100, 52.0) for i in range(1, 12)}
    ways = [
        (1, [1, 2], {"waterway": "river", "name": "Narew"}),
        (2, [3, 4], {"highway": "residential"}),            # dropped
        (3, [5, 6, 7, 5], {}),                              # untagged member of the lake relation: kept
        (4, [8, 9], {"highway": "primary", "bridge": "yes"}),
        (5, [10, 11], {"building": "yes"}),                 # dropped
    ]
    relations = [(7, [("way", 3, "outer")], {"type": "multipolygon", "natural": "water"})]
    return write_osm(tmp_path / "in.osm", nodes, ways, relations, node_tags={10: {"amenity": "bench"}})


def test_prefilter_keeps_waterways_and_references(src, tmp_path):
    dst = tmp_path / "out.osm.pbf"
    assert prefilter(src, dst) == 3  # river, bridge, lake relation
    c = contents(dst)
    assert set(c["w"]) == {1, 3, 4}
    assert c["w"][1]["name"] == "Narew"  # tags are kept
    assert c["r"] == {7}
    assert c["n"] == {1, 2, 5, 6, 7, 8, 9}


def test_main_writes_filtered_files(src, tmp_path, monkeypatch):
    out = tmp_path / "f"
    main([str(src), "-o", str(out)])
    assert (out / "in.filtered.osm.pbf").exists()
    monkeypatch.setattr(sys, "argv", ["interway-filter", str(src), "-o", str(out / "again")])
    runpy.run_module("interway_pipeline.prefilter", run_name="__main__")
    assert (out / "again" / "in.filtered.osm.pbf").exists()
