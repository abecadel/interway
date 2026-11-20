import pytest
from shapely.geometry import LineString, Point, Polygon

from interway_pipeline import lakes
from interway_pipeline.extract import Lake
from interway_pipeline.lakes import _lake_namer, _mesh, connect_lakes, water_bodies
from interway_pipeline.model import Segment, haversine, metres_to_deg
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


def test_lakes_need_two_entries_to_produce_edges():
    assert connect_lakes([], [], []) == []
    # an allowlisted lake is considered, but with no entries there is nothing to route between
    assert connect_lakes([], [Lake(1, "Wigry", box(0, 0, 3 * K, 2 * K), True)], []) == []
    assert connect_lakes([], [Lake(2, "Staw", box(0, 0, K, K), False)], []) == []
    # two marinas on an allowlisted lake are linked
    marinas = [("A", (0.2 * K, 0.2 * K)), ("B", (2.8 * K, 1.8 * K))]
    added = connect_lakes([], [Lake(1, "Wigry", box(0, 0, 3 * K, 2 * K), True)], marinas)
    assert len(added) == 1 and added[0].name == "Wigry"
    assert sorted(added[0].coords) == [(0.2 * K, 0.2 * K), (2.8 * K, 1.8 * K)]
    # a quay mapped on the shore (30 m off the polygon) still counts; one 200 m inland does not
    shore = [("Quay", (3.03 * K, 1.0 * K)), ("Inland", (0.5 * K, 2.2 * K))] + marinas[:1]
    added = connect_lakes([], [Lake(1, "Wigry", box(0, 0, 3 * K, 2 * K), True)], shore)
    ends = {c for s in added for c in (s.coords[0], s.coords[-1])}
    assert (3.03 * K, 1.0 * K) in ends and (0.5 * K, 2.2 * K) not in ends


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
    segs = _mesh(WEST.polygon, [WEST], [(7, entry), (8, (0.9 * K, 0.5 * K))])
    assert [(s.a, s.b) for s in segs] in ([(7, 8)], [(8, 7)])
    assert entry in (segs[0].coords[0], segs[0].coords[-1])


def test_direct_lines_stay_on_water():
    # U-shaped lake: the straight line between the tips crosses land
    u = box(0, 0, 3 * K, K).union(box(0, 0, K, 3 * K)).union(box(2 * K, 0, 3 * K, 3 * K))
    tips = [(1, (0.5 * K, 2.9 * K)), (2, (2.5 * K, 2.9 * K)), (3, (0.5 * K, 0.5 * K))]
    segs = _mesh(u, [Lake(1, "U", u, True)], tips)
    direct = {frozenset((s.a, s.b)) for s in segs if len(s.coords) == 2}
    assert frozenset((1, 2)) not in direct  # never straight across the land
    assert frozenset((1, 3)) in direct


def test_no_direct_lines_for_many_entries(monkeypatch):
    entries = [(i + 1, (K * (0.1 + 0.2 * i), K / 2)) for i in range(4)]
    with_direct = _mesh(WEST.polygon, [WEST], entries)
    assert any(s.a > 0 and s.b > 0 for s in with_direct)
    monkeypatch.setattr(lakes, "MAX_DIRECT_ENTRIES", 3)
    without = _mesh(WEST.polygon, [WEST], entries)
    assert len(set(components(without).values())) == 1  # still connected through the mesh
    assert {n for s in without for n in (s.a, s.b)} >= {1, 2, 3, 4}


def test_pruned_mesh_goes_around_land_and_is_small():
    u = box(0, 0, 3 * K, K).union(box(0, 0, K, 3 * K)).union(box(2 * K, 0, 3 * K, 3 * K))
    tips = [(1, (0.5 * K, 2.9 * K)), (2, (2.5 * K, 2.9 * K))]
    segs = _mesh(u, [Lake(1, "U", u, True)], tips)
    assert len(segs) == 1  # one straightened chain between the two tips
    (s,) = segs
    assert {s.a, s.b} == {1, 2}
    assert 3 <= len(s.coords) <= 6  # bends around the land in the middle, no zig-zag
    water = u.buffer(metres_to_deg(lakes.ENTRY_TOLERANCE_M))
    assert water.contains(LineString(s.coords))
    assert s.length < 2 * haversine((0.5 * K, 2.9 * K), (2.5 * K, 2.9 * K)) + 4 * 111_000 * K


def test_prune_keeps_junctions_between_three_entries():
    entries = [(1, (0.1 * K, 0.1 * K)), (2, (0.9 * K, 0.1 * K)), (3, (0.5 * K, 0.9 * K))]
    segs = _mesh(WEST.polygon, [WEST], entries)
    ends = {n for s in segs for n in (s.a, s.b)}
    assert {1, 2, 3} <= ends
    assert len(set(components(segs).values())) == 1


def test_many_entries_use_nearest_targets_and_stay_connected(monkeypatch):
    monkeypatch.setattr(lakes, "NEAREST_TARGETS", 2)
    # two clusters of entries at opposite ends of a long lake: nearest-neighbour links alone would not join them
    lake = box(0, 0, 10 * K, K)
    west = [(i + 1, (K * (0.1 + 0.1 * i), K / 2)) for i in range(4)]
    east = [(i + 11, (K * (9.5 + 0.1 * i), K / 2)) for i in range(4)]
    segs = _mesh(lake, [Lake(1, "Długie", lake, True)], west + east)
    assert len(set(components(segs).values())) == 1
    assert {n for s in segs for n in (s.a, s.b)} >= {1, 2, 3, 4, 11, 12, 13, 14}


def test_target_pairs_small_and_large():
    pos = {i: (i * 0.01, 0.0) for i in range(1, 11)} | {11: (-0.005, 0.0)}  # 11 sits on the far side of 1
    small = lakes._target_pairs([1, 2, 3], pos)
    assert small == {1: {2, 3}, 2: {1, 3}, 3: {1, 2}}
    big = lakes._target_pairs(list(range(1, 12)), pos)
    # collinear entries: each links to its neighbours along the line, nothing further
    assert big[1] == {11, 2} and big[5] == {4, 6} and big[11] == {1}
    assert sum(len(v) for v in big.values()) == 2 * 10  # a chain: O(n) links, not n² pairs


def test_target_pairs_grid_and_duplicates():
    pos = {i: (float(i % 5), float(i // 5)) for i in range(25)} | {99: (2.0, 2.0)}  # 99 shares 12's spot
    wanted = lakes._target_pairs(list(pos), pos)
    assert {7, 11, 13, 17, 99} <= wanted[12] and 12 in wanted[99]
    assert wanted[99] - {12} == wanted[12] - {99}  # same position, same neighbours
    assert all(len(v) <= 9 for v in wanted.values())  # local links only
    comp = {0}
    stack = [0]
    while stack:
        for v in wanted[stack.pop()] - comp:
            comp.add(v)
            stack.append(v)
    assert comp == set(pos)  # connected


def test_small_channel_areas_only_continue_dead_ends(monkeypatch):
    monkeypatch.setattr(lakes, "BRIDGE_WINDOW_M", 100_000.0)  # the test geometry spans tens of km
    # a river line passing through two small river-area pieces, and a dead-end canal ending at a third piece
    river = Segment(a=1, b=2, coords=[(0.0, 0.0), (0.1, 0.0)], kind="river")
    feeder = Segment(a=2, b=3, coords=[(0.1, 0.0), (0.2, 0.0)], kind="river")
    canal = Segment(a=10, b=11, coords=[(0.5, 0.0), (0.6, 0.0)], kind="canal")  # 11 is a dead end
    onward = Segment(a=20, b=21, coords=[(0.65, 0.0), (0.7, 0.0)], kind="canal")  # leaves the lake on the far side
    lake = Lake(5, "Pälitzsee", box(0.6 + 0.001, -0.01, 0.65, 0.01), False)
    piece_on_river = Lake(6, "", box(0.04, -0.001, 0.06, 0.001), False, kind="channel")
    piece_at_end = Lake(7, "", box(0.6, -0.001, 0.6011, 0.001), False, kind="channel")  # canal end -> lake
    added = connect_lakes([river, feeder, canal, onward], [lake, piece_on_river, piece_at_end], [])
    comp = components([river, feeder, canal, onward, *added])
    assert comp[11] == comp[20]  # the dead end reaches the lake's far side through the small piece
    # nothing was meshed along the river line
    assert not any(-0.002 < s.coords[0][1] < 0.002 and 0.03 < s.coords[0][0] < 0.07 for s in added)


def test_channel_bodies_only_bridge_dead_ends(monkeypatch):
    monkeypatch.setattr(lakes, "BRIDGE_WINDOW_M", 100_000.0)  # the test geometry spans tens of km
    # A long river area (two touching pieces). The river line runs through the west piece; it is broken
    # in the east piece: one part ends at 11, the next starts again at 12.
    west = Lake(1, "Odra", box(0.0, -0.002, 0.1, 0.002), True, kind="channel")
    east = Lake(2, "Odra", box(0.1, -0.002, 0.2, 0.002), True, kind="channel")
    river = [Segment(a=1, b=2, coords=[(-0.05, 0.0), (0.05, 0.0)], kind="river", name="Odra"),
             Segment(a=2, b=11, coords=[(0.05, 0.0), (0.12, 0.0)], kind="river", name="Odra"),
             Segment(a=12, b=13, coords=[(0.17, 0.0), (0.3, 0.0)], kind="river", name="Odra")]
    marinas = [("Przystań", (0.15, 0.001))]
    added = connect_lakes(river, [west, east], marinas)
    ends = {frozenset((s.a, s.b)) for s in added}
    assert frozenset((11, 12)) in ends  # the gap is bridged
    assert all({s.a, s.b} & {11, 12} for s in added)  # nothing else: the line stays the route
    assert not any(s.a < 0 or s.b < 0 for s in added)  # marinas are not linked through river areas
    comp = components([*river, *added])
    assert comp[1] == comp[13]


def test_channel_body_without_dead_ends_is_not_meshed():
    area = Lake(1, "Narew", box(0.0, -0.002, 0.1, 0.002), True, kind="channel")
    river = [Segment(a=1, b=2, coords=[(-0.05, 0.0), (0.05, 0.0)], kind="river"),
             Segment(a=2, b=3, coords=[(0.05, 0.0), (0.15, 0.0)], kind="river"),
             Segment(a=3, b=4, coords=[(0.15, 0.0), (0.2, 0.0)], kind="river")]
    assert connect_lakes(river, [area], []) == []


def test_lake_touching_channel_areas_is_meshed_normally(monkeypatch):
    monkeypatch.setattr(lakes, "BRIDGE_WINDOW_M", 100_000.0)  # the test geometry spans tens of km
    lake = Lake(1, "Zalew", box(0.0, -0.05, 0.1, 0.05), False)
    inflow = Lake(2, "Narew", box(-0.05, -0.002, 0.0, 0.002), False, kind="channel")
    river = [Segment(a=1, b=2, coords=[(-0.1, 0.0), (-0.03, 0.0)], kind="river"),  # 2 ends inside the inflow area
             Segment(a=3, b=4, coords=[(0.1003, 0.0), (0.2, 0.0)], kind="river")]  # 3 is on the far shore
    added = connect_lakes(river, [lake, inflow], [("Marina", (0.05, 0.04))])
    assert components([*river, *added])[1] == components([*river, *added])[4]
    assert any(s.a < 0 or s.b < 0 for s in added)  # marinas on a real lake are linked


def test_canal_along_a_reservoir_shore_is_not_linked_through_it():
    # Dzierżno Duże case: the canal runs along the shore on two levels (a lock between them); the reservoir
    # must not join them. A river that flows into the reservoir is an entry.
    reservoir = Lake(1, "Dzierżno", box(0.0, 0.0, 0.1, 0.05), False)
    shore = -metres_to_deg(30)
    canal = [Segment(a=0, b=1, coords=[(-0.1, shore), (0.0, shore)], kind="canal"),  # continues beyond the lake
             Segment(a=4, b=5, coords=[(0.1, shore), (0.2, shore)], kind="canal"),
             Segment(a=1, b=2, coords=[(0.0, shore), (0.05, shore)], kind="canal"),
             Segment(a=2, b=3, coords=[(0.05, shore), (0.051, shore)], kind="canal", lock=True),
             Segment(a=3, b=4, coords=[(0.051, shore), (0.1, shore)], kind="canal")]
    inflow = Segment(a=10, b=11, coords=[(0.05, 0.08), (0.05, 0.06), (0.05, 0.03)], kind="river")  # ends inside
    outflow = Segment(a=12, b=13, coords=[(0.09, 0.04), (0.095, 0.045), (0.2, 0.045)], kind="river")  # leaves
    # a river crossing the corner: node 31 lies in the water, reached by a segment drawn towards it
    through = [Segment(a=30, b=31, coords=[(-0.05, 0.02), (0.005, 0.021), (0.01, 0.02)], kind="river"),
               Segment(a=31, b=32, coords=[(0.01, 0.02), (0.02, 0.06)], kind="river")]
    added = connect_lakes([*canal, inflow, outflow, *through], [reservoir], [])
    linked = {n for s in added for n in (s.a, s.b)}
    assert {11, 12, 31} <= linked and not linked & {0, 1, 2, 3, 4, 5}


def test_lakes_a_lock_runs_between_are_not_one_body():
    # Hjellevannet above Skien lock and Bryggevannet below it touch at the dam
    lock = ((K - metres_to_deg(20), K / 2), (K + GAP + metres_to_deg(20), K / 2))
    assert sorted(len(m) for _, m in water_bodies([WEST, EAST], [lock])) == [1, 1]
    # either way round
    assert sorted(len(m) for _, m in water_bodies([WEST, EAST], [lock[::-1]])) == [1, 1]
    # a lock inside one lake (even by the shore it shares with the other), or far from both, keeps them together
    inside = ((K - metres_to_deg(40), K / 2), (K - metres_to_deg(20), K / 2))
    far = ((20 * K, 0.0), (21 * K, 0.0))
    assert sorted(len(m) for _, m in water_bodies([WEST, EAST], [inside, far])) == [2]


def test_reservoir_above_a_lock_is_not_meshed_with_the_basin_below():
    above_lake = Lake(1, "Hjellevannet", box(-0.01, 0.0, 0.0, 0.01), False)
    below_lake = Lake(2, "Bryggevannet", box(0.0, 0.0, 0.01, 0.01), False)
    upper = Segment(a=1, b=2, coords=[(-0.005, 0.02), (-0.005, 0.005), (-0.0003, 0.005)], kind="river")
    lock = Segment(a=2, b=3, coords=[(-0.0003, 0.005), (0.0003, 0.005)], kind="canal", lock=True)
    lower = Segment(a=3, b=4, coords=[(0.0003, 0.005), (0.005, 0.005), (0.005, 0.05)], kind="river")
    chamber = Lake(3, "", box(-0.0004, 0.0049, 0.0004, 0.0051), False)  # water=lock, touching both
    added = connect_lakes([upper, lock, lower], [above_lake, below_lake, chamber], [])
    segs = [upper, lock, lower, *added]
    free = [s for s in segs if not s.lock]
    reach = {1}
    while True:
        more = {n for s in free for n in (s.a, s.b) if {s.a, s.b} & reach} - reach
        if not more:
            break
        reach |= more
    assert 4 not in reach  # from above the lock, the reach below is only through the lock


def test_a_lock_is_not_a_way_into_the_basin_below_it():
    # Skien: the lock chamber's middle lies in the harbour basin below; the reach above the lock must not be
    # joined to the basin, or routes skip the lock. The river below continues into the basin and is an entry.
    basin = Lake(1, "Bryggevannet", box(0.0, 0.0, 0.01, 0.01), False)
    above = Segment(a=1, b=2, coords=[(-0.05, 0.005), (-0.0002, 0.005)], kind="river")
    lock = Segment(a=2, b=3, coords=[(-0.0002, 0.005), (0.0004, 0.005)], kind="canal", lock=True)
    below = Segment(a=3, b=4, coords=[(0.0004, 0.005), (0.005, 0.005), (0.005, 0.05)], kind="river")
    out = Segment(a=5, b=6, coords=[(0.0098, 0.002), (0.0099, 0.001), (0.05, 0.001)], kind="river")
    added = connect_lakes([above, lock, below, out], [basin], [])
    linked = {n for s in added for n in (s.a, s.b)}
    assert {3, 5} <= linked and 2 not in linked
    # the same with the reach above mapped only as an area: the lock's upper end is a dead end
    added = connect_lakes([lock, below, out], [basin], [])
    linked = {n for s in added for n in (s.a, s.b)}
    assert {3, 5} <= linked and 2 not in linked


def test_a_lock_inside_one_river_area_opens_on_both_ends(monkeypatch):
    # Lilla Edet: the Göta älv is mapped only as one area around the lock; its lower end lies a metre outside
    # the area and its upper end inside. Both ends are dead ends and both are ways into the river.
    monkeypatch.setattr(lakes, "BRIDGE_WINDOW_M", 100_000.0)
    area = Lake(1, "Göta älv", box(0.0, -0.002, 0.2, 0.002), False, kind="channel")
    up = metres_to_deg(1.0)
    lock = Segment(a=2, b=3, coords=[(0.1, 0.0), (0.101, 0.002 + up)], kind="canal", lock=True)
    below = Segment(a=5, b=6, coords=[(-0.05, 0.0), (0.0, 0.0)], kind="river")
    added = connect_lakes([lock, below], [area], [])
    linked = {n for s in added for n in (s.a, s.b)}
    assert {2, 3, 6} <= linked


def test_bridges_are_marked_and_can_be_cut_around_locks(monkeypatch):
    monkeypatch.setattr(lakes, "BRIDGE_WINDOW_M", 100_000.0)  # the test geometry spans tens of km
    from interway_pipeline.topology import block_lock_bypasses
    area = Lake(1, "Odra", box(0.0, -0.002, 0.2, 0.002), False, kind="channel")
    river = [Segment(a=1, b=2, coords=[(-0.05, 0.0), (0.05, 0.0)], kind="river"),
             Segment(a=12, b=13, coords=[(0.15, 0.0), (0.3, 0.0)], kind="river")]
    added = connect_lakes(river, [area], [])
    assert added and all(s.kind == "bridge" for s in added)
    lock_canal = [Segment(a=2, b=20, coords=[(0.05, 0.0), (0.1, 0.01)], kind="canal"),
                  Segment(a=20, b=21, coords=[(0.1, 0.01), (0.101, 0.01)], kind="canal", lock=True),
                  Segment(a=21, b=12, coords=[(0.101, 0.01), (0.15, 0.0)], kind="canal")]
    kept, removed = block_lock_bypasses([*river, *added, *lock_canal])
    assert any(s.kind == "bridge" for s in removed)  # the bridge across the weir reach is cut, not the canal
    assert all(s in kept for s in lock_canal)


def test_bridging_stays_within_a_window_around_dead_ends():
    r = metres_to_deg(lakes.BRIDGE_WINDOW_M)
    # A long river area. The line arrives from the south and stops at 11; it resumes at 12, 2 km downstream,
    # and runs on (13 is an ordinary node 30 km away, 15 ends outside the area).
    area = Lake(1, "Odra", box(-0.01, -0.002, 0.5, 0.002), False, kind="channel")
    river = [Segment(a=10, b=11, coords=[(0.0, -0.5), (0.0, 0.0)], kind="river"),
             Segment(a=12, b=13, coords=[(metres_to_deg(2000), 0.0), (0.27, 0.0)], kind="river"),
             Segment(a=13, b=15, coords=[(0.27, 0.0), (0.6, 0.0)], kind="river")]
    # a pond inside the window but apart from the river (no entries) and a lake touching the window at a point
    pond = Lake(2, "", box(0.0, 0.02, metres_to_deg(500), 0.025), False, kind="channel")
    tangent = Lake(3, "", Polygon([(-r, 0.0), (-2 * r, -r), (-2 * r, r)]), False)
    added = connect_lakes(river, [area, pond, tangent], [])
    linked = {n for s in added for n in (s.a, s.b)}
    assert {11, 12} <= linked and 13 not in linked
    assert all(max(x for x, _ in s.coords) < metres_to_deg(2000) + r for s in added)


def test_river_areas_are_not_crossed_over_weirs():
    # Liffey case: a river area runs from a dead end (11) to another waterway (12); a weir across it in between
    half = metres_to_deg(40)  # an 80 m wide river
    area = Lake(1, "Liffey", box(-0.01, -half, 0.1, half), False, kind="channel")
    river = [Segment(a=10, b=11, coords=[(0.0, -0.1), (0.0, 0.0)], kind="river"),
             Segment(a=12, b=13, coords=[(0.05, 0.0), (0.05, 0.1)], kind="river")]
    assert connect_lakes(river, [area], [])  # open water: bridged
    for weir in (LineString([(0.03, -0.01), (0.03, 0.01)]), Point(0.03, 0.0)):
        added = connect_lakes(river, [area], [], [weir, Point(5.0, 5.0)])
        comp = components([*river, *added])
        assert comp[11] != comp[12]


def test_short_channel_area_between_lakes_is_a_strait():
    jagodne = Lake(1, "Jagodne", box(0.0, 0.0, 0.05, 0.05), False)
    boczne = Lake(2, "Boczne", box(0.06, 0.0, 0.11, 0.05), False)
    kula = Lake(3, "Kanał Kula", box(0.0499, 0.02, 0.0601, 0.025), False, kind="channel")  # ~0.7 km
    long_river = Lake(4, "Rzeka", box(0.05, 0.03, 0.2, 0.035), False, kind="channel")      # ~10 km: no
    pond_link = Lake(5, "", box(0.2, 0.2, 0.201, 0.201), False, kind="channel")            # touches no lake
    river = [Segment(a=1, b=2, coords=[(-0.05, 0.01), (0.0, 0.01)], kind="river"),       # into Jagodne
             Segment(a=3, b=4, coords=[(0.11, 0.01), (0.15, 0.01)], kind="river")]        # out of Boczne
    added = connect_lakes(river, [jagodne, boczne, kula, long_river, pond_link], [])
    comp = components([*river, *added])
    assert comp[2] == comp[3]  # through the strait
    assert {lk.name for lk in lakes._straits([jagodne, boczne, kula, long_river, pond_link])} == {"Kanał Kula"}
    assert lakes._straits([kula]) == []
