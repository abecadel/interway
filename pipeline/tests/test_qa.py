from interway_pipeline.model import Segment, metres_to_deg
from interway_pipeline.qa import gap_candidates


def seg(a, b, x0, x1, y=0.0):
    return Segment(a=a, b=b, coords=[(x0, y), (x1, y)], kind="canal")


def test_gap_candidates_sorted_by_component_size():
    m = metres_to_deg(1)
    segs = [
        seg(1, 2, 0, 0.1), seg(2, 3, 0.1, 0.2),            # big component, dead ends at 1 and 3
        seg(4, 5, 0.2 + 300 * m, 0.25),                      # medium, 300 m beyond node 3
        seg(6, 7, -500 * m - 0.01, -500 * m),                # small, 500 m before node 1
        seg(8, 9, 5, 5.01),                                  # far away: no candidate
        seg(10, 11, 0.2 + 2500 * m, 0.3),                    # inside the search box of node 3 but too far
    ]
    fc = gap_candidates(segs)
    props = [f["properties"] for f in fc["features"]]
    # the 3<->4 gap joins bigger components than the 1<->7 gap
    assert [p["gap_m"] for p in props] == [300, 499, 1611]  # each gap once, biggest components first
    assert props[0]["to_component_km"] > 0
    assert gap_candidates(segs, limit=1)["features"].__len__() == 1


def test_gap_candidates_empty():
    assert gap_candidates([]) == {"type": "FeatureCollection", "features": []}
