import pytest
from shapely.geometry import LineString, Point, Polygon

from interway_pipeline import lakes
from interway_pipeline.extract import Lake
from interway_pipeline.lakes import _lake_namer, _mesh, connect_lakes, water_bodies
from interway_pipeline.model import Segment, metres_to_deg
from interway_pipeline.topology import components

K = metres_to_deg(1000)


def box(x0, y0, x1, y1):
    return Polygon([(x0, y0), (x1, y0), (x1, y1), (x0, y1)])


def river(a, b, p, q, name="Rzeka"):
    return Segment(a=a, b=b, coords=[p, q], name=name, kind="river", flows=True)


GAP = metres_to_deg(10)
WEST = Lake(1, "Zachodnie", box(0, 0, K, K), False)
EAST = Lake(2, "Wschodnie", box(K + GAP, 0, 2 * K, K), False)  # 10 m channel between the lakes
FAR = Lake(3, "Daleko", box(10 * K, 0, 11 * K, K), False)


def test_touching_lakes_become_one_body():
    bodies = water_bodies([WEST, FAR, EAST])
    assert sorted(len(m) for _, m in bodies) == [1, 2]
    body, members = next(b for b in bodies if len(b[1]) == 2)
    assert {m.name for m in members} == {"Zachodnie", "Wschodnie"}
    assert body.geom_type == "Polygon"  # the gap is closed
    assert body.contains(Point(K + GAP / 2, K / 2))
    assert body.area == pytest.approx(WEST.polygon.area + EAST.polygon.area, rel=0.02)
    single = next(b for b in bodies if len(b[1]) == 1)
    assert single[0] is FAR.polygon


def test_tiny_touching_lakes_keep_their_own_shape():
    # closing then opening by 25 m erases ponds smaller than that: fall back to the plain union
    m = metres_to_deg(1)
    a, b = Lake(1, "a", box(0, 0, m, m), True), Lake(2, "b", box(5 * m, 0, 6 * m, m), True)
    [(body, members)] = water_bodies([a, b])
    assert len(members) == 2 and body.area == pytest.approx(2 * m * m)


def test_chain_of_lakes_is_routable():
    west_in = river(1, 2, (-K, K / 2), (0, K / 2))
    east_out = river(3, 4, (2 * K, K / 2), (3 * K, K / 2))
    elsewhere = river(5, 6, (20 * K, 0), (21 * K, 0))
    segs = [west_in, east_out, elsewhere]
    added = connect_lakes(segs, [WEST, EAST, FAR], marinas=[("Port", (1.5 * K, 0.5 * K)), ("Ląd", (5 * K, 5 * K))])
    assert added and all(s.kind == "lake" for s in added)
    comp = components(segs + added)
    assert comp[1] == comp[4] != comp[5]
    names = {s.name for s in added}
    assert names == {"Zachodnie", "Wschodnie"}  # FAR has no entry and is not allowlisted
    # the mesh stays on water
    body = water_bodies([WEST, EAST])[0][0].buffer(metres_to_deg(lakes.ENTRY_TOLERANCE_M))
    assert all(body.contains(LineString(s.coords)) for s in added)
    # the marina in the east lake became an entry; the one on land did not
    marina = [s for s in added if (1.5 * K, 0.5 * K) in (s.coords[0], s.coords[-1])]
    assert marina
    assert not any((5 * K, 5 * K) in (s.coords[0], s.coords[-1]) for s in added)


def test_allowlisted_lake_without_entries_gets_a_mesh():
    assert connect_lakes([], [], []) == []
    lake = Lake(1, "Wigry", box(0, 0, 3 * K, 2 * K), True)
    added = connect_lakes([], [lake], [])
    assert added and {s.name for s in added} == {"Wigry"}
    assert len(set(components(added).values())) == 1  # one connected mesh
    assert connect_lakes([], [Lake(2, "Staw", box(0, 0, K, K), False)], []) == []


def test_namer_uses_member_or_nearest():
    one = _lake_namer([WEST])
    assert one((50, 50)) == "Zachodnie"
    two = _lake_namer([WEST, EAST])
    assert two((K / 2, K / 2)) == "Zachodnie"
    assert two((1.5 * K, K / 2)) == "Wschodnie"
    assert two((K + 0.8 * GAP, K / 2)) == "Wschodnie"  # in the closed gap, nearer to the east shore


def test_mesh_of_empty_body():
    assert _mesh(Polygon(), [WEST], [(1, (0, 0))]) == []


def test_single_triangle_lake_uses_direct_lines():
    m = metres_to_deg(100)
    tri = Polygon([(0, 0), (m, 0), (0, m)])
    entries = [(1, (0.1 * m, 0.1 * m)), (2, (0.6 * m, 0.1 * m)), (3, (0.6 * m, 0.1 * m))]
    segs = _mesh(tri, [Lake(1, "Trójkąt", tri, True)], entries)
    # no mesh nodes; the duplicate entry position is not linked to itself
    assert sorted((s.a, s.b) for s in segs) == [(1, 2), (1, 3)]


def test_entry_outside_triangles_links_to_nearest():
    entry = (-metres_to_deg(30), K / 2)  # 30 m off the west shore, within the entry tolerance
    segs = _mesh(WEST.polygon, [WEST], [(7, entry)])
    links = [s for s in segs if s.a == 7]
    assert links and all(s.coords[0] == entry for s in links)


def test_direct_lines_stay_on_water():
    # U-shaped lake: the straight line between the tips crosses land
    u = box(0, 0, 3 * K, K).union(box(0, 0, K, 3 * K)).union(box(2 * K, 0, 3 * K, 3 * K))
    tips = [(1, (0.5 * K, 2.9 * K)), (2, (2.5 * K, 2.9 * K)), (3, (0.5 * K, 0.5 * K))]
    segs = _mesh(u, [Lake(1, "U", u, True)], tips)
    direct = {(s.a, s.b) for s in segs if s.a > 0 and s.b > 0}
    assert direct == {(1, 3)}


def test_no_direct_lines_for_many_entries(monkeypatch):
    entries = [(i + 1, (K * (0.1 + 0.2 * i), K / 2)) for i in range(4)]
    with_direct = _mesh(WEST.polygon, [WEST], entries)
    assert any(s.a > 0 and s.b > 0 for s in with_direct)
    monkeypatch.setattr(lakes, "MAX_DIRECT_ENTRIES", 3)
    without = _mesh(WEST.polygon, [WEST], entries)
    assert not any(s.a > 0 and s.b > 0 for s in without)
    assert len(set(components(without).values())) == 1  # still connected through the mesh
