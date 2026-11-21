import numpy as np
import pytest
import shapefile
from shapely.geometry import LineString, Point, box

from interway_pipeline.model import Segment
from interway_pipeline.sea import Coast, _thin, connect_to_sea, drop_sheltered, from_merc, mark_offshore, sea_mesh, to_merc
from interway_pipeline.topology import components

# Two islands 0.1° apart (about 11 km) in a 1° sea; the strait between them is navigable.
WEST = box(0.2, 0.2, 0.45, 0.8)
EAST = box(0.55, 0.2, 0.8, 0.8)
BBOX = (0.0, 0.0, 1.0, 1.0)


def coast(*polys):
    return Coast(list(polys or (WEST, EAST)))


def test_mercator_round_trip():
    pts = np.array([[0.0, 0.0], [21.0, 52.25], [-10.0, 36.0]])
    assert np.allclose(from_merc(to_merc(pts)), pts)
    assert np.allclose(to_merc(np.array([[1.0, 0.0]]))[0], [111319.49, 0.0], atol=0.01)


def test_load_reads_only_the_bbox(tmp_path):
    with shapefile.Writer(str(tmp_path / "land"), shapeType=shapefile.POLYGON) as w:
        w.field("id", "N")
        for i, b in enumerate([WEST, box(10, 10, 11, 11)]):
            w.poly([list(b.exterior.coords)[::-1]])  # clockwise outer ring
            w.record(i)
    c = Coast.load(tmp_path / "land.shp", BBOX)
    assert len(c.land) == 1
    assert c.on_land(np.array([Point(*to_merc(np.array([[0.3, 0.5]]))[0])])).tolist() == [True]


def test_load_reads_each_polygon_once_for_overlapping_boxes(tmp_path):
    with shapefile.Writer(str(tmp_path / "land"), shapeType=shapefile.POLYGON) as w:
        w.field("id", "N")
        for i, b in enumerate([WEST, EAST, box(10, 10, 11, 11)]):
            w.poly([list(b.exterior.coords)[::-1]])
            w.record(i)
    c = Coast.load(tmp_path / "land.shp", [(0.0, 0.0, 0.5, 1.0), (0.3, 0.0, 1.0, 1.0)])
    assert len(c.land) == 2  # WEST lies in both boxes and is loaded once; the far island in neither


def test_areas_mesh_together_and_far_areas_form_their_own_part():
    c = coast(WEST, EAST, box(3.2, 0.2, 3.45, 0.8))
    # the first area as a single bbox gives the same mesh as before
    one = sea_mesh(c, BBOX, grid_m=10000)
    same = sea_mesh(c, areas=[{"bbox": BBOX}], grid_m=10000)
    assert sorted(s.coords for s in one) == sorted(s.coords for s in same)
    # an overlapping neighbour on the same grid joins up; an area 2° away is a part of its own
    both = sea_mesh(c, areas=[{"bbox": BBOX}, {"bbox": (0.8, 0.0, 1.6, 1.0)}, {"bbox": (3.0, 0.0, 3.6, 1.0)}], grid_m=10000)
    parts = components(both)
    assert len(set(parts.values())) == 2
    xs = {round(x, 6) for s in both for x, _ in s.coords}
    assert max(xs) > 3.4 and any(1.0 < x < 1.6 for x in xs)
    # each area may keep its grid closer to the coast
    near = sea_mesh(c, areas=[{"bbox": BBOX}, {"bbox": (3.0, 0.0, 3.6, 1.0), "max_offshore_m": 1.0}], grid_m=10000)
    assert sum(1 for s in near for x, _ in s.coords if x > 3.0) < sum(1 for s in both for x, _ in s.coords if x > 3.0)


def test_a_refine_area_may_set_its_own_grid():
    c = coast(box(0.30, 0.10, 0.36, 0.90))
    usual = sea_mesh(c, areas=[{"bbox": BBOX}, {"bbox": (0.2, 0.2, 0.5, 0.8), "refine": True}], grid_m=25000)
    dense = sea_mesh(c, areas=[{"bbox": BBOX}, {"bbox": (0.2, 0.2, 0.5, 0.8), "refine": True, "grid_m": 2000.0}], grid_m=25000)
    assert len(dense) > len(usual)


def test_refine_areas_straighten_passages_between_islands():
    # a 1° sea with a long island splitting it into two sounds, and an islet in the eastern sound
    land = [box(0.30, 0.10, 0.36, 0.90), box(0.62, 0.45, 0.66, 0.55)]
    c = coast(*land)
    base = sea_mesh(c, BBOX, grid_m=25000)
    fine = sea_mesh(c, areas=[{"bbox": BBOX}, {"bbox": (0.05, 0.05, 0.95, 0.95), "refine": True}], grid_m=25000)
    assert len(fine) > len(base)
    lines = np.array([LineString(to_merc(np.array(s.coords))) for s in fine])
    assert not c.crossing(lines).any()
    # edges that skip a node: some are longer than any plain edge between neighbours inside the box
    assert len(set(components(fine).values())) == 1

    def km(segs, a, b):
        import heapq

        from interway_pipeline.model import haversine
        g: dict = {}
        for s in segs:
            p, q = tuple(s.coords[0]), tuple(s.coords[1])
            g.setdefault(p, []).append((q, haversine(p, q)))
            g.setdefault(q, []).append((p, haversine(p, q)))
        start = min(g, key=lambda n: haversine(n, a))
        goal = min(g, key=lambda n: haversine(n, b))
        dist, heap = {start: 0.0}, [(0.0, start)]
        while heap:
            d, n = heapq.heappop(heap)
            if n == goal:
                return d / 1000
            for m, w in g[n]:
                if d + w < dist.get(m, float("inf")):
                    dist[m] = d + w
                    heapq.heappush(heap, (d + w, m))
        return float("inf")

    a, b = (0.45, 0.15), (0.50, 0.85)  # up the eastern sound, past the islet
    straight = 0.70 * 111.32
    assert km(fine, a, b) < straight * 1.1


def test_two_hop_handles_empty_input():
    from interway_pipeline.sea import _two_hop
    c = coast()
    assert _two_hop(c, np.zeros(0, dtype=object), np.zeros((0, 2))).size == 0
    line = np.array([LineString([(0, 0), (1, 0)])])
    assert _two_hop(c, line, np.array([[0.0, 0.0], [1.0, 0.0]])).size == 0  # a single edge: nothing two apart


def test_masks_handle_empty_input():
    c = coast()
    assert c.near_land(np.zeros((0, 2)), 10).size == 0
    assert c.on_land(np.zeros(0, dtype=object)).size == 0
    assert c.crossing(np.zeros(0, dtype=object)).size == 0
    assert _thin(np.zeros((0, 2)), 10).size == 0
    assert not c.covers(Point(to_merc(np.array([[0.05, 0.05]]))[0]).buffer(10))


def test_mesh_is_connected_and_stays_off_land():
    c = coast()
    segs = sea_mesh(c, BBOX, coast_step_m=3000, grid_m=10000)
    assert segs and all(s.kind == "sea" for s in segs)
    assert len(set(components(segs).values())) == 1  # around the islands and through the strait
    lines = np.array([LineString(to_merc(np.array(s.coords))) for s in segs])
    assert not c.crossing(lines).any()
    # some edge runs through the 11 km strait
    assert any(0.45 < s.coords[0][0] < 0.55 and 0.3 < s.coords[0][1] < 0.7 for s in segs)


def test_mesh_without_water_is_empty():
    assert sea_mesh(coast(box(-1, -1, 2, 2)), BBOX) == []


def test_offshore_grid_needs_a_coast_nearby():
    # no land at all: no coast nodes, so the grid is not limited and still meshes
    segs = sea_mesh(Coast([box(5, 5, 5.1, 5.1)]), BBOX, grid_m=20000)
    assert segs


def test_connect_to_sea():
    c = coast()
    sea = sea_mesh(c, BBOX, coast_step_m=3000, grid_m=10000)
    river = [Segment(a=1, b=2, coords=[(0.3, 0.5), (0.4499, 0.5)], kind="river")]          # ends at the coast
    canal = [Segment(a=3, b=4, coords=[(0.25, 0.3), (0.35, 0.3)], kind="canal")]             # deep inland
    fairway = [Segment(a=5, b=6, coords=[(0.1, 0.1), (0.15, 0.1)], kind="fairway")]          # in the sea
    links = connect_to_sea(river + canal + fairway, sea, c, max_link_m=20000)
    linked = {s.a for s in links}
    assert linked == {2, 5, 6}
    assert all(s.kind == "sea" for s in links)
    assert len([s for s in links if s.a == 5]) == 2  # two links per node
    assert connect_to_sea(river, [], c) == [] and connect_to_sea([], sea, c) == []


def test_connect_skips_links_that_cross_land():
    c = coast()
    # a single mesh edge on the far side of the west island: the only link would cross it
    sea = [Segment(a=-1, b=-2, coords=[(0.1, 0.5), (0.1, 0.55)], kind="sea")]
    river = [Segment(a=1, b=2, coords=[(0.3, 0.5), (0.4499, 0.5)], kind="river")]
    assert connect_to_sea(river, sea, c, max_link_m=100000) == []


@pytest.mark.parametrize(("mole_deg", "linked"), [(0.0003, True), (0.002, False)])
def test_connect_crosses_a_sliver_of_land(mole_deg, linked):
    # a mole across the way to the only mesh node: ~30 m (simplification noise) is crossed, ~200 m is not
    c = coast(WEST, box(0.05, 0.13, 0.15, 0.13 + mole_deg))
    sea = [Segment(a=-1, b=-2, coords=[(0.1, 0.15), (0.1, 0.16)], kind="sea")]
    fairway = [Segment(a=5, b=6, coords=[(0.1, 0.1), (0.1, 0.11)], kind="fairway")]
    assert bool(connect_to_sea(fairway, sea, c, max_link_m=20000)) is linked


@pytest.mark.parametrize("pt", [(0.3, 0.5)])
def test_on_land(pt):
    c = coast()
    assert c.on_land(np.array([Point(*to_merc(np.array([pt]))[0])])).tolist() == [True]


def test_narrow_straits_get_a_finer_mesh():
    # a land band across the sea with a 670 m channel: too narrow for the default 500 m coast offset
    c = Coast([box(0.0, 0.4, 0.497, 0.6), box(0.503, 0.4, 1.0, 0.6)])
    coarse = sea_mesh(c, BBOX, grid_m=10000, narrows={})
    assert len(set(components(coarse).values())) == 2
    fine = sea_mesh(c, BBOX, grid_m=10000, narrows={"Channel": (0.48, 0.38, 0.52, 0.62), "Nowhere": (5, 5, 6, 6)})
    assert len(set(components(fine).values())) == 1
    assert sea_mesh(c, BBOX, grid_m=10000)  # default narrows lie outside this bbox


def test_grid_moves_handle_holes():
    from interway_pipeline.sea import _grid_moves
    assert _grid_moves(np.zeros((0, 2)), 0, 0, 10).size == 0
    assert _grid_moves(np.array([[0.0, 0.0], [50.0, 50.0]]), 0, 0, 10).size == 0  # no neighbours one move apart
    lines = _grid_moves(np.array([[0.0, 0.0], [10.0, 0.0], [20.0, 10.0]]), 0, 0, 10)
    assert len(lines) == 3  # a straight move, a diagonal and a knight's move


def test_open_water_crossings_are_nearly_straight():
    import heapq

    from interway_pipeline.model import haversine
    segs = sea_mesh(Coast([box(5, 5, 5.1, 5.1)]), (0.0, 0.0, 2.0, 2.0), grid_m=10000)
    adj: dict = {}
    pos = {}
    for s in segs:
        w = haversine(s.coords[0], s.coords[-1])
        adj.setdefault(s.a, []).append((s.b, w))
        adj.setdefault(s.b, []).append((s.a, w))
        pos[s.a], pos[s.b] = s.coords[0], s.coords[-1]
    src = min(pos, key=lambda n: pos[n][0] + pos[n][1])
    dst = max(pos, key=lambda n: pos[n][0] + 0.4 * pos[n][1])  # an awkward bearing, not a grid diagonal
    dist = {src: 0.0}
    heap = [(0.0, src)]
    while heap:
        d, u = heapq.heappop(heap)
        if d > dist[u]:
            continue
        for v, w in adj[u]:
            if d + w < dist.get(v, float("inf")):
                dist[v] = d + w
                heapq.heappush(heap, (d + w, v))
    assert dist[dst] / haversine(pos[src], pos[dst]) < 1.05


def test_drop_sheltered_removes_the_mesh_inside_a_lagoon():
    c = coast()
    segs = sea_mesh(c, BBOX, coast_step_m=3000, grid_m=10000)
    lagoon = box(0.0, 0.85, 1.0, 1.0)  # open to the sea on the south side
    kept = drop_sheltered(segs, [lagoon])
    assert 0 < len(kept) < len(segs)
    inner = lagoon.buffer(-0.002)
    assert not any(inner.contains(Point(p)) for s in kept for p in s.coords)
    assert len(set(components(kept).values())) == 1  # the rest of the sea stays one mesh
    assert drop_sheltered(segs, []) is segs
    assert drop_sheltered([], [lagoon]) == []


def test_mark_offshore_flags_sea_far_from_land():
    c = coast(box(0.0, 60.0, 0.1, 60.1))  # at 60°N a degree of longitude is about 55.7 km
    near = Segment(a=1, b=2, coords=[(0.12, 60.05), (0.14, 60.05)], kind="sea")  # middle ~1.7 km off
    far = Segment(a=3, b=4, coords=[(0.40, 60.05), (0.42, 60.05)], kind="sea")  # ~17 km off
    assert mark_offshore([near, far], c, km=10) == 1
    assert (near.offshore, far.offshore) == (False, True)
    assert mark_offshore([], c) == 0
    # no land within reach of any segment: all offshore
    lone = Segment(a=5, b=6, coords=[(5.0, 60.0), (5.01, 60.0)], kind="sea")
    assert mark_offshore([lone], c, km=10) == 1 and lone.offshore
