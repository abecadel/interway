import pytest
from shapely.geometry import LineString, Polygon

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
    segs = {s.osm_way: s for s in split_ways(ex)}
    assert segs[1].lock and segs[1].name == "Śluza Dolna"
    assert segs[2].lock and segs[2].name == "Śluza Górna"  # no `name`, lock_name used
    assert not segs[3].lock and segs[3].name == "Boczny"  # lock gates only at the ends (junctions)
    assert segs[4].lock and segs[4].name == "Kanał B"  # unnamed lock keeps the waterway name


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
        way(13, [2, 3, 2], kind="river"),                           # loop
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
    ex = Extract(connectors=[NavWay(1, [5, 6], [(2 * D, 0.0), (2 * D + metres_to_deg(50), D)], {"kind": "river"}),
                             NavWay(2, [7, 8], [(1 * D, 0.0), (1 * D + metres_to_deg(80), D)], {"kind": "river"})])
    segs = net((1, 2))
    segs.append(Segment(a=3, b=4, coords=[(2 * D + metres_to_deg(50), D), (3 * D, D)]))
    assert add_connectors(segs, ex) == 1
    assert segs[-1].osm_way == 1


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
    assert len(patches) == 2
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
