import pytest
from shapely.geometry import LineString, Polygon, box

from interway_pipeline import topology
from interway_pipeline.extract import Extract, Lake, NavWay
from interway_pipeline.model import Limits, Segment, metres_to_deg
from interway_pipeline.topology import (
    add_connectors,
    apply_bridges,
    close_gaps,
    components,
    drop_small_components,
    merge_degree2,
    new_node_id,
    node_positions,
    split_ways,
)

D = metres_to_deg(100)  # 100 m in degrees, used as grid step near the equator


def way(wid, nodes, kind="canal", **tags):
    return NavWay(wid, nodes, [(n * D, 0.0) for n in nodes], {"kind": kind, **tags})


def ends(segs):
    return sorted((s.a, s.b) for s in segs)


# --- split_ways -------------------------------------------------------------------------------------------

def test_split_at_shared_nodes_only():
    ex = Extract(ways=[way(1, [1, 2, 3, 4, 5]), way(2, [3, 6])])
    segs = split_ways(ex)
    assert ends(segs) == [(1, 3), (3, 5), (3, 6)]
    first = next(s for s in segs if s.a == 1)
    assert first.coords == [(1 * D, 0.0), (2 * D, 0.0), (3 * D, 0.0)]
    assert first.osm_way == 1 and first.kind == "canal" and not first.flows


def test_way_crossing_itself_splits_at_the_repeated_node():
    # a closed loop way 1-2-3-1 starts and ends at the same node: kept as one loop segment
    segs = split_ways(Extract(ways=[way(1, [1, 2, 3, 1])]))
    assert ends(segs) == [(1, 1)]
    assert len(segs[0].coords) == 4


def test_degenerate_two_node_loop_dropped():
    assert split_ways(Extract(ways=[way(1, [5, 5])])) == []


def test_barrier_cuts_the_waterway():
    ex = Extract(ways=[way(1, [1, 2, 3], kind="river"), way(2, [3, 4, 5], kind="river")], barrier_nodes={2, 3})
    segs = split_ways(ex)
    assert len(segs) == 3
    nodes = [n for s in segs for n in (s.a, s.b)]
    assert 2 not in nodes and 3 not in nodes
    synthetic = [n for n in nodes if n < 0]
    assert len(synthetic) == len(set(synthetic)) == 4  # every cut end is its own dead end
    assert set(synthetic) <= topology.barrier_ends
    assert len(set(components(segs).values())) == 3
    assert all(s.flows for s in segs)  # rivers flow along their drawing direction


def test_lock_from_interior_node_and_way_tag():
    ex = Extract(ways=[way(1, [1, 2, 3], name="Kanał"), way(2, [3, 4], lock="yes", lock_name="Śluza Górna"),
                       way(3, [1, 7, 8], name="Boczny"), way(4, [8, 9, 10], name="Kanał B")],
                 lock_nodes={2, 1, 8, 9}, lock_names={2: "Śluza Dolna"})
    segs = split_ways(ex)
    by_way = lambda w: [s for s in segs if s.osm_way == w]  # noqa: E731
    # gates 1 and 2 are 100 m apart: the stretch between them is the chamber, the rest of the way is not a lock
    assert [(s.lock, s.name, s.a, s.b) for s in by_way(1)] == [(True, "Śluza Dolna", 1, 2), (False, "Kanał", 2, 3)]
    assert [(s.lock, s.name) for s in by_way(2)] == [(True, "Śluza Górna")]  # no `name`, lock_name used
    assert [s.lock for s in by_way(3)] == [False]  # gates 700 m apart, each at a way end (junctions)
    assert [(s.lock, s.name) for s in by_way(4)] == [(True, "Kanał B"), (False, "Kanał B")]  # unnamed chamber


def test_single_interior_gate_is_a_zero_length_lock():
    ex = Extract(ways=[way(1, [1, 2, 3], name="Kanał")], lock_nodes={2}, lock_names={2: "Śluza"})
    k = split_ways(ex)
    assert [(s.lock, s.name) for s in k] == [(False, "Kanał"), (True, "Śluza"), (False, "Kanał")]
    assert k[1].coords[0] == k[1].coords[1] and k[0].b == k[1].a and k[1].b == k[2].a
    assert (k[0].a, k[2].b) == (1, 3)


def test_lock_chamber_between_two_gates_and_separate_locks():
    m = 1 / 111_320  # one metre in degrees
    nodes = {i: (x * m, 0.0) for i, x in enumerate([0, 1000, 1150, 1300, 5000, 9000], start=1)}
    ex = Extract(ways=[NavWay(1, list(nodes), list(nodes.values()), {"name": "Kanał", "waterway": "canal", "kind": "canal"})],
                 lock_nodes={2, 3, 5}, lock_names={3: "Śluza Wielka"})
    segs = split_ways(ex)
    assert [(s.lock, s.name, round(s.length, -1)) for s in segs] == [
        (False, "Kanał", 1000),
        (True, "Śluza Wielka", 150),       # gates 2 and 3 (150 m apart) are one chamber
        (False, "Kanał", 3850),
        (True, "Kanał", 0),                # gate 5 alone, 3.7 km further: a second lock
        (False, "Kanał", 4000),
    ]


def test_oneway_reversed_and_limits():
    ex = Extract(ways=[way(1, [1, 2], oneway="-1", draft="1.5", maxheight="4", maxwidth="9,5 m", maxlength="80"),
                       way(2, [2, 3], oneway="yes", maxdraft="2", draft="1")])
    s1, s2 = split_ways(ex)
    assert (s1.a, s1.b, s1.oneway) == (2, 1, True)
    assert s1.coords == [(2 * D, 0.0), (1 * D, 0.0)]
    assert s1.limits.as_tuple() == (1.5, 4, 9.5, 80)
    assert (s2.a, s2.b, s2.oneway) == (2, 3, True)
    assert s2.limits.max_draft == 2


# --- add_connectors ---------------------------------------------------------------------------------------

def net(*pairs):
    return [Segment(a=a, b=b, coords=[(a * D, 0.0), (b * D, 0.0)], kind="canal") for a, b in pairs]


def test_connectors_need_both_ends_on_water():
    lake = Lake(1, "Jezioro", Polygon([(20 * D, -D), (30 * D, -D), (30 * D, D), (20 * D, D)]), False)
    ex = Extract(lakes=[lake], lock_nodes={14}, connectors=[
        way(10, [2, 14, 20], kind="river", name="Łącznik"),         # network node 2 -> lake: added, with lock
        NavWay(11, [2, 50], [(2 * D, 0.0), (2 * D, 5 * D)], {"kind": "river"}),  # other end on land
        way(12, [2], kind="river"),                                 # single point
        way(13, [20, 25, 20], kind="river"),                        # loop inside the lake
        way(14, [2, 15, 21], kind="river"),                         # passes a weir
        NavWay(15, [1, 99], [(1 * D, 0.0), (1 * D, 40 * D)], {"kind": "river"}),  # 4 km: too long
        way(16, [21, 2], kind="canal", lock="yes", maxdraft="1.2"),
    ], barrier_nodes={15})
    segs = net((1, 2))
    assert add_connectors(segs, ex) == 2
    c, c2 = segs[1:]
    assert (c.a, c.b, c.kind, c.lock, c.name, c.osm_way) == (2, 20, "connector", True, "Łącznik", 10)
    assert (c2.a, c2.b, c2.lock, c2.limits.max_draft) == (21, 2, True, 1.2)


def test_connector_end_tolerance():
    # network node 2 at (2D, 0); a lake whose shore is at y = D
    lake = Lake(1, "Jezioro", box(0, D, 5 * D, 3 * D), False)
    ex = Extract(lakes=[lake], connectors=[
        NavWay(1, [5, 6], [(2 * D + metres_to_deg(50), 0.0), (2 * D, D)], {"kind": "river"}),  # 50 m off: ok
        NavWay(2, [7, 8], [(2 * D + metres_to_deg(80), 0.0), (2 * D, D)], {"kind": "river"}),  # 80 m off: no
    ])
    segs = net((1, 2))
    assert add_connectors(segs, ex) == 1
    assert segs[-1].osm_way == 1


def test_connectors_need_a_lake_end():
    lake = Lake(1, "Jezioro", box(0, D, 5 * D, 3 * D), False)
    channel = Lake(2, "Kanał", box(10 * D, -D, 20 * D, D), False, kind="channel")  # river areas do not count
    ex = Extract(lakes=[lake, channel], connectors=[
        way(1, [1, 3], kind="river", name="Kłodnica"),                                  # network to network
        NavWay(2, [4, 5], [(2 * D, 2 * D), (4 * D, 2 * D)], {"kind": "river"}),        # inside the lake: ok
        NavWay(3, [6, 7], [(3 * D, 0.0), (3 * D, 1.5 * D)], {"kind": "river"}),        # network -> lake: ok
        NavWay(4, [8, 9], [(15 * D, 0.0), (1 * D, 0.0)], {"kind": "river"}),           # channel area -> network
    ])
    segs = net((1, 2), (2, 3))
    assert add_connectors(segs, ex) == 2
    assert [s.osm_way for s in segs[2:]] == [2, 3]
    # lake to lake works without any network at all
    assert add_connectors([], Extract(lakes=[lake], connectors=[ex.connectors[1]])) == 1


def test_connectors_without_targets():
    assert add_connectors([], Extract()) == 0
    assert add_connectors([], Extract(connectors=[way(1, [1, 2], kind="river")])) == 0


# --- apply_bridges ----------------------------------------------------------------------------------------

def test_bridges_tighten_crossed_segments():
    segs = net((1, 2), (2, 3))
    across = LineString([(1.5 * D, -D), (1.5 * D, D)])
    elsewhere = LineString([(10 * D, -D), (10 * D, D)])
    assert apply_bridges(segs, [(across, 4.0), (across, 3.5), (across, 5.0), (elsewhere, 1.0)]) == 3
    assert segs[0].limits.max_height == 3.5
    assert segs[1].limits.max_height == 0
    assert apply_bridges(segs, []) == 0
    assert apply_bridges([], [(across, 2.0)]) == 0


# --- close_gaps -------------------------------------------------------------------------------------------

def test_close_gaps_links_nearby_dead_ends_once():
    g = metres_to_deg(10)
    segs = [
        Segment(a=1, b=2, coords=[(0.0, 0.0), (D, 0.0)]),
        Segment(a=3, b=4, coords=[(D + g, 0.0), (2 * D, 0.0)]),       # 10 m gap to node 2
        Segment(a=5, b=6, coords=[(D + g, g), (D + g, 2 * D)]),        # another dead end close to 2 and 3
        Segment(a=7, b=8, coords=[(10 * D, 0.0), (11 * D, 0.0)]),     # far away
    ]
    assert close_gaps(segs) == 2
    patches = [s for s in segs if s.kind == "patch"]
    assert len(patches) == 2 and not any(p.lock for p in patches)  # mapping slips are plain water
    assert len(set(components(segs).values())) == 2  # 1-6 joined, 7-8 left alone


def test_close_gaps_skips_same_component_and_barriers():
    g = metres_to_deg(5)
    # a U-shaped single component whose two dead ends are 5 m apart: no shortcut
    u = [Segment(a=1, b=2, coords=[(0.0, 0.0), (0.0, D)]), Segment(a=2, b=3, coords=[(0.0, D), (g, D)]),
         Segment(a=3, b=4, coords=[(g, D), (g, 0.0)])]
    assert close_gaps(u) == 0
    cut_a, cut_b = new_node_id(), new_node_id()
    topology.barrier_ends.update({cut_a, cut_b})
    weir = [Segment(a=1, b=cut_a, coords=[(0.0, 0.0), (D, 0.0)]),
            Segment(a=cut_b, b=2, coords=[(D + g, 0.0), (2 * D, 0.0)]),
            Segment(a=5, b=6, coords=[(D, g), (D, D)])]  # a dead end next to a cut end
    assert close_gaps(weir) == 0
    assert close_gaps([]) == 0


# --- merge_degree2 ----------------------------------------------------------------------------------------

def seg(a, b, **kw):
    kw.setdefault("kind", "canal")
    return Segment(a=a, b=b, coords=[(a * D, 0.0), (b * D, 0.0)], **kw)


def test_merge_reverses_undirected_segments():
    out = merge_degree2([seg(2, 1), seg(2, 3), seg(4, 3)])
    assert len(out) == 1
    s = out[0]
    assert {s.a, s.b} == {1, 4}
    xs = [x for x, _ in s.coords]
    assert xs == sorted(xs) or xs == sorted(xs, reverse=True)
    assert len(xs) == 4


@pytest.mark.parametrize("kw", [{"kind": "river", "flows": True}, {"oneway": True}])
def test_merge_follows_direction(kw):
    # listed out of order: the second segment comes first in the chain
    out = merge_degree2([seg(2, 3, **kw), seg(1, 2, **kw)])
    assert [(s.a, s.b) for s in out] == [(1, 3)]
    assert [x for x, _ in out[0].coords] == [1 * D, 2 * D, 3 * D]


@pytest.mark.parametrize("pair", [((1, 2), (3, 2)), ((2, 1), (2, 3))])
def test_directed_segments_never_merge_against_each_other(pair):
    (a1, b1), (a2, b2) = pair
    segs = [seg(a1, b1, kind="river", flows=True), seg(a2, b2, kind="river", flows=True)]
    assert ends(merge_degree2(segs)) == ends(segs)


def test_merge_respects_attributes_locks_and_loops():
    assert len(merge_degree2([seg(1, 2, name="A"), seg(2, 3, name="B")])) == 2
    assert len(merge_degree2([seg(1, 2), seg(2, 3, limits=Limits(max_draft=2))])) == 2
    assert len(merge_degree2([seg(1, 2, lock=True), seg(2, 3)])) == 2
    assert len(merge_degree2([seg(1, 2), seg(2, 2)])) == 2  # node 2 has a loop attached
    assert len(merge_degree2([seg(1, 1), seg(1, 2)])) == 2
    # two parallel segments between 1 and 2 must not collapse into a loop
    assert len(merge_degree2([seg(1, 2), seg(2, 1)])) == 2


def test_merge_long_chain_updates_incidence():
    # 1-2-3-4-5-6 given in shuffled order and orientation
    out = merge_degree2([seg(3, 4), seg(2, 1), seg(5, 6), seg(3, 2), seg(5, 4)])
    assert len(out) == 1 and {out[0].a, out[0].b} == {1, 6}
    assert len(out[0].coords) == 6


# --- components -------------------------------------------------------------------------------------------

def test_drop_small_components():
    segs = net((1, 2), (2, 3), (10, 11))
    out, report = drop_small_components(segs, min_length_m=150)
    assert ends(out) == [(1, 2), (2, 3)]
    assert [r["length_m"] for r in report] == [200, 100]
    assert node_positions(out) == {1: (D, 0.0), 2: (2 * D, 0.0), 3: (3 * D, 0.0)}


def test_components_with_cycles():
    comp = components(net((1, 2), (2, 3), (3, 1), (4, 5), (5, 4)))
    assert comp[1] == comp[2] == comp[3] != comp[4] == comp[5]


def test_close_gaps_joins_facing_dead_ends_across_a_ship_lift():
    m = metres_to_deg(1)
    upper = Segment(a=1, b=2, coords=[(0.0, 0.0), (0.01, 0.0)], kind="canal")
    lower = Segment(a=3, b=4, coords=[(0.01 + 120 * m, 0.0), (0.03, 0.0)], kind="canal")
    # a node of a third component 100 m away but not a dead end (mid-junction) must not be used
    side = [Segment(a=5, b=6, coords=[(0.01 + 100 * m, 0.02), (0.01 + 100 * m, 100 * m)], kind="canal"),
            Segment(a=6, b=7, coords=[(0.01 + 100 * m, 100 * m), (0.01 + 100 * m, -0.02)], kind="canal")]
    segs = [upper, lower, *side]
    assert close_gaps(list(segs)) == 0  # default: only 25 m mapping slips
    work = list(segs)
    assert close_gaps(work, dead_end_gap_m=300) == 1
    link = work[-1]
    assert {link.a, link.b} == {2, 3} and link.kind == "patch" and link.lock  # a lift/lock: counted as a lock
    work = list(segs)
    assert close_gaps(work, dead_end_gap_m=100) == 0  # 120 m apart


# --- block_lock_bypasses --------------------------------------------------------------------------------

def _canal(a, b, x0, x1, y=0.0, **kw):
    return Segment(a=a, b=b, coords=[(x0, y), (x1, y)], kind=kw.pop("kind", "canal"), **kw)


def test_untagged_twin_chamber_and_weir_branch_are_removed():
    from interway_pipeline.topology import block_lock_bypasses
    segs = [
        _canal(1, 2, 0.0, 0.01),
        _canal(2, 3, 0.01, 0.011, lock=True, name="Śluza A"),          # tagged chamber
        Segment(a=2, b=3, coords=[(0.01, 0.0), (0.0105, 0.0003), (0.011, 0.0)], kind="canal"),  # twin, untagged
        _canal(3, 4, 0.011, 0.02),
        # a river loop around the lock canal (weir not mapped)
        Segment(a=1, b=4, coords=[(0.0, 0.0), (0.01, 0.01), (0.02, 0.0)], kind="river", name="Odra"),
    ]
    kept, removed = block_lock_bypasses(segs)
    assert {s.name for s in removed} == {"", "Odra"}  # the untagged twin first, then the river loop
    assert len(kept) == 3 and any(s.lock for s in kept)


def test_bypasses_with_another_lock_or_across_lakes_are_kept():
    from interway_pipeline.topology import block_lock_bypasses
    two_locks = [
        _canal(1, 2, 0.0, 0.01, lock=True),
        Segment(a=1, b=2, coords=[(0.0, 0.0), (0.005, 0.005), (0.01, 0.0)], kind="canal", lock=True),
    ]
    assert block_lock_bypasses(two_locks)[1] == []
    lake = [_canal(1, 2, 0.0, 0.01, lock=True), _canal(1, 2, 0.0, 0.01, y=0.001, kind="lake")]
    assert block_lock_bypasses(lake)[1] == []
    far = [_canal(1, 2, 0.0, 0.01, lock=True),
           Segment(a=1, b=2, coords=[(0.0, 0.0), (0.0, 1.0), (0.01, 0.0)], kind="river")]  # 220 km loop
    assert block_lock_bypasses(far)[1] == []
    loop_lock = [Segment(a=5, b=5, coords=[(0, 0), (0.01, 0.01), (0, 0)], kind="canal", lock=True)]
    assert block_lock_bypasses(loop_lock)[1] == []


def test_bypass_cut_keeps_the_canal_and_prefers_rivers():
    from interway_pipeline.topology import block_lock_bypasses
    segs = [
        _canal(1, 2, 0.0, 0.01, name="canal-up"),
        _canal(2, 3, 0.01, 0.011, lock=True),
        _canal(3, 4, 0.011, 0.02, name="canal-down"),
        # weir branch split by a tributary junction 9: one river half and one canal-tagged half
        Segment(a=1, b=9, coords=[(0.0, 0.0), (0.005, 0.01)], kind="canal", name="side canal"),
        Segment(a=9, b=4, coords=[(0.005, 0.01), (0.02, 0.0)], kind="river", name="Odra"),
        Segment(a=9, b=10, coords=[(0.005, 0.01), (0.005, 0.05)], kind="river", name="tributary"),
    ]
    kept, removed = block_lock_bypasses(segs)
    assert [s.name for s in removed] == ["Odra"]
    assert {"canal-up", "canal-down", "side canal", "tributary"} <= {s.name for s in kept}


def test_bypass_cuts_are_capped_per_lock(monkeypatch):
    from interway_pipeline import topology
    monkeypatch.setattr(topology, "MAX_BYPASS_CUTS", 1)
    segs = [_canal(1, 2, 0.0, 0.01, lock=True),
            Segment(a=1, b=2, coords=[(0.0, 0.0), (0.005, 0.002), (0.01, 0.0)], kind="canal"),
            Segment(a=1, b=2, coords=[(0.0, 0.0), (0.005, 0.004), (0.01, 0.0)], kind="canal")]
    assert len(topology.block_lock_bypasses(segs)[1]) == 1


def test_bypass_cut_never_disconnects():
    from interway_pipeline.topology import block_lock_bypasses
    # a port basin P reached from both sides of a lock: cutting one link is fine, cutting the second would
    # strand the port, so it stays
    segs = [_canal(1, 2, 0.0, 0.001, lock=True),
            Segment(a=1, b=9, coords=[(0.0, 0.0), (0.0005, 0.003)], kind="bridge"),
            Segment(a=9, b=2, coords=[(0.0005, 0.003), (0.001, 0.0)], kind="bridge")]
    kept, removed = block_lock_bypasses(segs)
    assert len(removed) == 1 and 9 in {n for s in kept for n in (s.a, s.b)}


def test_no_cut_when_the_only_other_way_is_too_long():
    from interway_pipeline.topology import block_lock_bypasses
    # an (artificially) ~350 km long lock beside a 111 km bypass: the bypass is found, but no cut leaves its
    # ends connected within twice the search distance, so nothing is removed
    segs = [Segment(a=1, b=2, coords=[(0.0, 0.0), (0.5, 1.5), (1.0, 0.0)], kind="canal", lock=True),
            Segment(a=1, b=3, coords=[(0.0, 0.0), (0.5, 0.0)], kind="river"),
            Segment(a=3, b=2, coords=[(0.5, 0.0), (1.0, 0.0)], kind="river")]
    assert block_lock_bypasses(segs, max_m=250_000)[1] != []
    assert block_lock_bypasses(segs, max_m=120_000)[1] == []
