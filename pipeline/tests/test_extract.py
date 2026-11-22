import logging

import osmium
import pytest
from fixture import write_osm
from shapely.geometry import MultiPolygon, Point, Polygon

from interway_pipeline import extract
from interway_pipeline.classify import Allowlist
from interway_pipeline.extract import _area_polygon, read_osm


def square(first_id, lon, lat, size):
    """Four corner nodes of a square, counter-clockwise, as {id: (lon, lat)}."""
    pts = [(lon, lat), (lon + size, lat), (lon + size, lat + size), (lon, lat + size)]
    return {first_id + i: p for i, p in enumerate(pts)}


def ring(first_id):
    return [first_id, first_id + 1, first_id + 2, first_id + 3, first_id]


NODES = {
    1: (20.00, 52.00), 2: (20.01, 52.00), 3: (20.02, 52.00), 4: (20.03, 52.00),
    10: (20.0, 52.1), 11: (20.0, 52.11),
    20: (20.05, 52.0), 21: (20.06, 52.0), 22: (20.07, 52.0),
    # nodes carrying tags
    30: (20.1, 52.0), 31: (20.1, 52.01), 32: (20.1, 52.02), 33: (20.1, 52.03), 34: (20.1, 52.04),
    35: (20.1, 52.05), 36: (20.1, 52.06), 37: (20.1, 52.07), 38: None, 39: (20.1, 52.08), 40: (20.1, 52.09), 41: None,
    **square(100, 21.0, 52.0, 0.01),     # big lake
    **square(110, 21.1, 52.0, 0.001),    # small lake
    **square(120, 21.2, 52.0, 0.001),    # small allowlisted lake
    **square(130, 21.3, 52.0, 0.02),     # multipolygon outer
    **square(140, 21.305, 52.005, 0.01),  # ... and its inner ring
    **square(150, 21.4, 52.0, 0.002),    # marina area
    **square(160, 21.5, 52.0, 0.01),     # forest, not water
    170: (21.6, 52.0), 171: (21.61, 52.0), 172: (21.62, 52.0),  # collinear "polygons"
    **square(180, 21.7, 52.0, 0.001),    # small canal area
    **square(190, 21.8, 52.0, 0.001),    # small old-style riverbank
}
NODE_TAGS = {
    30: {"waterway": "lock_gate", "name": "Śluza"},
    31: {"lock": "yes"},
    32: {"seamark:type": "gate"},
    33: {"waterway": "weir"},
    34: {"waterway": "dam"},
    35: {"waterway": "waterfall"},
    36: {"waterway": "weir", "lock": "yes"},  # weir with a lock is passable
    37: {"leisure": "marina", "name": "Port Node", "website": "https://port.example", "vhf": "9", "capacity": "120",
         "fuel:diesel": "yes", "power_supply": "yes"},
    38: {"leisure": "marina", "name": "No location"},
    # storm-surge barriers stand open: not locks, even when tagged as lock gates
    39: {"waterway": "lock_gate", "man_made": "storm_surge_barrier", "name": "Thames Barrier"},
    40: {"seamark:type": "gate", "seamark:gate:category": "flood_barrage"},
    20: {"waterway": "fuel", "name": "Paliwo"},
    41: {"waterway": "weir"},  # no location
}
WAYS = [
    (1, [1, 2, 3, 4], {"waterway": "canal", "name": "Kanał", "CEMT": "II", "maxdraft": "1.8", "oneway": "-1",
                       "surface": "water"}),
    (2, [10, 999], {"waterway": "canal", "CEMT": "II"}),            # node 999 is outside the extract
    (3, [10], {"waterway": "canal", "CEMT": "II"}),                 # a single node
    (4, [20, 21, 22], {"waterway": "river", "name": "Struga"}),     # connector candidate
    (5, [20, 998], {"waterway": "river"}),                          # connector with a missing node
    (6, list(range(1000, 1400)), {"waterway": "river"}),            # long unverified river: not a connector
    (7, [10, 11], {"waterway": "stream"}),
    (8, [1, 2], {"highway": "primary", "bridge": "yes", "seamark:bridge:clearance_height": "4.5",
                 "maxheight": "3.8"}),                              # maxheight is for road traffic: ignored
    (9, [2, 3], {"highway": "primary", "bridge": "movable", "seamark:bridge:clearance_height": "3"}),  # opens
    (10, [3, 4], {"railway": "rail", "bridge": "yes", "seamark:bridge:clearance_height": "6 ft"}),
    (11, [3, 4], {"highway": "path", "bridge": "yes"}),             # no clearance known
    (12, [3, 4], {"highway": "path", "bridge": "no", "maxheight": "2"}),
    (13, [3, 997], {"highway": "path", "bridge": "yes", "seamark:bridge:clearance_height": "2"}),
    (14, [3], {"highway": "path", "bridge": "yes", "seamark:bridge:clearance_height": "2"}),
    (15, [30, 31], {"waterway": "weir"}),
    (16, [32], {"waterway": "dam"}),                               # a single node
    (17, [32, 996], {"waterway": "weir"}),                         # a missing node
    (18, [33, 34], {"waterway": "weir", "lock": "yes"}),
    (19, [1, 10], {"waterway": "lock_gate", "name": "Gate"}),       # a gate drawn as a line
    (20, [2, 995], {"waterway": "lock_gate"}),                     # a missing node
    (21, [3, 11], {"waterway": "dam", "name": "Big Dam"}),
    (100, ring(100), {"natural": "water", "name": "Duże"}),
    (110, ring(110), {"natural": "water", "name": "Oczko"}),
    (120, ring(120), {"natural": "water", "name": "Mały", "boat": "yes"}),
    (130, ring(130), {}),
    (140, ring(140), {}),
    (150, ring(150), {"leisure": "marina", "name": "Port Area"}),
    (160, ring(160), {"natural": "wood"}),
    (170, [170, 171, 172, 170], {"natural": "water", "name": "Kreska"}),
    (171, [170, 171, 172, 170], {"leisure": "marina", "name": "Broken"}),
    (172, ring(160), {"landuse": "harbour", "name": "Port Handlowy"}),
    (173, [170, 171, 172, 170], {"landuse": "harbour", "name": "Broken port"}),
    (180, ring(180), {"natural": "water", "water": "canal", "name": "Kanałek"}),
    (190, ring(190), {"waterway": "riverbank", "name": "Brzeg"}),
    (191, ring(110), {"natural": "water", "water": "lock", "name": "Śluza Przegalina"}),
    (192, [170, 171, 172, 170], {"natural": "water", "water": "lock"}),  # degenerate
]
RELATIONS = [
    (1, [("way", 130, "outer"), ("way", 140, "inner")], {"type": "multipolygon", "natural": "water", "name": "Wyspa"}),
]


@pytest.fixture(scope="module")
def ex(tmp_path_factory):
    path = write_osm(tmp_path_factory.mktemp("osm") / "x.osm", NODES, WAYS, RELATIONS, NODE_TAGS)
    return read_osm(path, Allowlist(names={"kanał"}), min_lake_km2=0.05)


def test_lock_and_barrier_nodes(ex):
    assert ex.lock_nodes == {30, 31, 32, 36}
    assert ex.lock_names == {30: "Śluza"}
    assert ex.barrier_nodes == {33, 34, 35, 41}


def test_weirs(ex):
    assert sorted(w.geom_type for w in ex.weirs) == ["LineString", "LineString", "Point", "Point", "Point"]
    assert [list(w.coords) for w in ex.weirs if w.geom_type == "LineString"][0] == [(20.1, 52.0), (20.1, 52.01)]


def test_gate_and_dam_lines(ex):
    assert [(list(g.coords), name, nodes) for g, name, nodes in ex.gate_lines] == [
        ([(20.0, 52.0), (20.0, 52.1)], "Gate", frozenset({1, 10}))]
    assert [(name, nodes) for _, name, nodes in ex.dam_lines] == [("Big Dam", frozenset({3, 11}))]


def test_excluded_ways_are_left_out(tmp_path):
    nodes = {1: (0.0, 47.5), 2: (0.0, 47.6)}
    ways = [(1, [1, 2], {"waterway": "canal", "CEMT": "IV"}), (2, [1, 2], {"waterway": "canal", "CEMT": "IV"})]
    path = write_osm(tmp_path / "x.osm", nodes, ways)
    assert [w.id for w in read_osm(path, Allowlist(exclude_ways={2})).ways] == [1]


def test_passable_dams_do_not_cut(tmp_path):
    nodes = {1: (0.0, 47.5), 2: (0.0, 47.6), 3: (0.0, 47.7)}
    path = write_osm(tmp_path / "x.osm", nodes, [(1, [1, 2, 3], {"waterway": "river", "CEMT": "IV"})],
                     node_tags={2: {"waterway": "dam"}, 3: {"waterway": "dam"}})
    assert read_osm(path, Allowlist(passable_nodes={2})).barrier_nodes == {3}


def test_navigable_ways(ex):
    assert [w.id for w in ex.ways] == [1]  # 2 misses a node location, 3 has a single node
    w = ex.ways[0]
    assert w.nodes == [1, 2, 3, 4]
    assert w.coords[0] == pytest.approx((20.0, 52.0))
    # oneway=-1 is kept as a tag: topology reverses the way
    assert w.tags == {"name": "Kanał", "waterway": "canal", "CEMT": "II", "maxdraft": "1.8", "oneway": "-1", "kind": "canal"}


def test_connector_candidates(ex):
    assert [w.id for w in ex.connectors] == [4]
    assert ex.connectors[0].tags == {"name": "Struga", "waterway": "river", "kind": "river"}


def test_bridges(ex):
    got = sorted((round(h, 3), line.coords[0]) for line, h in ex.bridges)
    assert got == [(1.829, pytest.approx((20.02, 52.0))), (4.5, pytest.approx((20.0, 52.0)))]


def test_lakes(ex):
    lakes = {lk.name: lk for lk in ex.lakes}
    # Oczko is too small and Kreska degenerate; small canal/river areas are kept because they link waterways
    assert set(lakes) == {"Duże", "Mały", "Wyspa", "Kanałek", "Brzeg"}
    assert {n for n, lk in lakes.items() if lk.kind == "channel"} == {"Kanałek", "Brzeg"}
    assert not lakes["Duże"].allowlisted
    assert lakes["Mały"].allowlisted  # small but boat=yes
    assert lakes["Duże"].id == 200  # area id of way 100
    wyspa = lakes["Wyspa"].polygon
    assert lakes["Wyspa"].id == 3  # area id of relation 1
    assert len(wyspa.interiors) == 1
    assert not wyspa.contains(Point(21.31, 52.01))
    assert wyspa.contains(Point(21.301, 52.001))


def test_marinas(ex):
    marinas = dict(ex.marinas)
    assert set(marinas) == {"Port Node", "Port Area"}
    assert marinas["Port Node"] == pytest.approx((20.1, 52.07))
    assert Polygon([NODES[i] for i in ring(150)]).contains(Point(marinas["Port Area"]))


def test_timestamp_from_pbf_header(tmp_path):
    h = osmium.io.Header()
    h.set("osmosis_replication_timestamp", "2026-11-01T00:00:00Z")
    path = tmp_path / "t.osm.pbf"
    w = osmium.SimpleWriter(str(path), header=h)
    w.add_node(osmium.osm.mutable.Node(id=1, location=(20.0, 52.0)))
    w.close()
    assert read_osm(path, Allowlist()).timestamp == "2026-11-01T00:00:00Z"


def test_unreadable_header_is_ignored(tmp_path, monkeypatch, caplog):
    path = write_osm(tmp_path / "t.osm", {1: (0.0, 0.0), 2: (0.0, 0.01)}, [(1, [1, 2], {"waterway": "fairway"})])

    def broken(*_a, **_k):
        raise RuntimeError("no header")

    monkeypatch.setattr(extract.osmium.io, "Reader", broken)
    with caplog.at_level(logging.INFO):
        ex = read_osm(path, Allowlist())
    assert ex.timestamp == ""
    assert [w.id for w in ex.ways] == [1]
    assert "1 navigable" in caplog.text


class FakeLoc:
    def __init__(self, lon, lat):
        self.lon, self.lat = lon, lat


class FakeArea:
    """Duck-typed osmium area: {outer ring: [inner rings]} as coordinate lists."""

    def __init__(self, rings):
        self.rings = rings

    def outer_rings(self):
        return [[FakeLoc(*c) for c in outer] for outer in self.rings]

    def inner_rings(self, outer):
        key = tuple((n.lon, n.lat) for n in outer)
        inner = next(v for k, v in self.rings.items() if k == key)
        return [[FakeLoc(*c) for c in r] for r in inner]


SQUARE = ((0, 0), (1, 0), (1, 1), (0, 1), (0, 0))
BOWTIE = ((10, 0), (11, 1), (11, 0), (10, 1), (10, 0))


def test_area_polygon_skips_short_rings():
    assert _area_polygon(FakeArea({((0, 0), (1, 0), (0, 0)): []})) is None
    p = _area_polygon(FakeArea({SQUARE: [((0.2, 0.2), (0.4, 0.2), (0.2, 0.2))]}))
    assert isinstance(p, Polygon) and not p.interiors


def test_area_polygon_repairs_invalid_rings():
    bowtie = _area_polygon(FakeArea({BOWTIE: []}))
    assert bowtie.is_valid and isinstance(bowtie, MultiPolygon) and len(bowtie.geoms) == 2
    assert bowtie.area == pytest.approx(0.5)  # both lobes survive
    both = _area_polygon(FakeArea({SQUARE: [], BOWTIE: []}))
    assert isinstance(both, MultiPolygon) and len(both.geoms) == 3  # flattened, not nested
    assert both.area == pytest.approx(1.5)


def test_area_polygon_drops_rings_that_vanish():
    flat = ((0, 0), (1, 0), (2, 0), (0, 0))
    assert _area_polygon(FakeArea({flat: []})) is None


def test_services(ex):
    got = {(k, n) for k, n, _, _ in ex.services}
    assert got == {("marina", "Port Node"), ("marina", "Port Area"), ("fuel", "Paliwo"), ("port", "Port Handlowy")}
    facts = {n: dict(f) for _, n, _, f in ex.services}
    assert facts["Port Node"] == {"website": "https://port.example", "vhf": "9", "berths": "120",
                                  "services": "diesel, electricity"}
    assert facts["Paliwo"] == {}
    assert ("Port Handlowy", "port") not in dict(ex.marinas).items()  # only marinas feed lake entries


def test_lock_areas(ex):
    # chambers are kept apart from lakes (meshing them would bypass the lock)
    assert [n for n, _ in ex.lock_areas] == ["Śluza Przegalina"]
    assert "Śluza Przegalina" not in {lk.name for lk in ex.lakes}


def test_rivers_navigable_in_part_are_taken_only_in_their_reach(tmp_path):
    nodes = {1: (0.0, 47.5), 2: (0.0, 47.6), 3: (0.0, 48.5), 4: (0.0, 48.6), 9: None}
    ways = [(1, [1, 2], {"waterway": "river", "name": "La Sarthe"}),  # in the reach
            (2, [3, 4], {"waterway": "river", "name": "La Sarthe"}),  # upstream
            (3, [2, 9], {"waterway": "river", "name": "La Sarthe"})]  # cut at the extract's border
    path = write_osm(tmp_path / "x.osm", nodes, ways)
    allow = Allowlist(bounded={"sarthe": [(-0.5, 47.0, 0.5, 48.0)]})
    assert [w.id for w in read_osm(path, allow).ways] == [1]
