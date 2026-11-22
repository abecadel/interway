from fixture import write_osm

from interway_pipeline.extract import Extract, NavWay
from interway_pipeline.relnames import cached_relation_names, name_from_relations, read_relation_names

NODES = {1: (20.0, 52.0), 2: (20.01, 52.0), 3: (20.02, 52.0)}
WAYS = [(1, [1, 2], {"waterway": "fairway"}), (2, [2, 3], {"waterway": "river"})]
RELATIONS = [
    (10, [("way", 1, ""), ("way", 2, "")], {"type": "waterway", "waterway": "river", "name": "Fleuve"}),
    (11, [("way", 1, "")], {"type": "route", "ship": "yes", "name": "Seaway"}),
    (12, [("way", 2, "")], {"type": "route", "route": "ferry", "name": "Ferry"}),
    (13, [("way", 2, "")], {"type": "route", "route": "boat"}),  # no name
    (14, [("way", 2, "")], {"type": "route", "name": "Bus 5"}),  # a route, but not for boats
    (15, [("node", 1, ""), ("way", 1, "")], {"type": "multipolygon", "name": "Lake"}),
    # a later, less specific relation (and a node member) leaves the name found first
    (16, [("node", 1, ""), ("way", 1, "")], {"type": "waterway", "name": "Other"}),
]


def test_names_prefer_boat_routes_over_waterways(tmp_path):
    path = write_osm(tmp_path / "r.osm", NODES, WAYS, RELATIONS)
    assert read_relation_names(path) == {1: "Seaway", 2: "Fleuve"}
    cache = tmp_path / "cache"
    assert cached_relation_names(path, cache) == {1: "Seaway", 2: "Fleuve"}
    assert len(list(cache.glob("*.relnames.json"))) == 1
    assert cached_relation_names(path, cache) == {1: "Seaway", 2: "Fleuve"}  # from the cache
    assert cached_relation_names(path, None) == {1: "Seaway", 2: "Fleuve"}


def test_only_unnamed_ways_and_connectors_are_named():
    ex = Extract()
    ex.ways = [NavWay(1, [1, 2], [(0, 0), (1, 0)], {"kind": "fairway"}), NavWay(2, [2, 3], [(1, 0), (2, 0)], {"name": "Own"})]
    ex.connectors = [NavWay(3, [3, 4], [(2, 0), (3, 0)], {"name": ""})]
    assert name_from_relations(ex, {1: "Seaway", 2: "Fleuve", 3: "Canal"}) == 2
    assert [w.tags.get("name") for w in ex.ways + ex.connectors] == ["Seaway", "Own", "Canal"]
