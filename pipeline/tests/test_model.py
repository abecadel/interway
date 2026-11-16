import pytest

from interway_pipeline.model import Limits, Segment, haversine, line_length, metres_to_deg, parse_metres


@pytest.mark.parametrize("value,expected", [
    (None, 0), ("", 0), ("3.5", 3.5), ("3,5 m", 3.5), ("12 ft", 12 * 0.3048), ("12'", 12 * 0.3048),
    ("4;5", 4), ("default", 0), ("0", 0), ("-2", 0), ("1500", 0),
])
def test_parse_metres(value, expected):
    assert parse_metres(value) == pytest.approx(expected)


def test_distances():
    assert haversine((0, 0), (0, 1)) == pytest.approx(111_195, rel=1e-3)
    assert haversine((10, 50), (10, 50)) == 0
    assert line_length([(0, 0), (0, 1), (0, 2)]) == pytest.approx(2 * haversine((0, 0), (0, 1)))
    assert metres_to_deg(111_320) == 1


def test_tighten_height_keeps_lowest_known():
    lim = Limits()
    lim.tighten_height(0)
    assert lim.max_height == 0  # unknown clearance does not restrict
    lim.tighten_height(5)
    assert lim.max_height == 5
    lim.tighten_height(7)
    assert lim.max_height == 5
    lim.tighten_height(3.2)
    assert lim.as_tuple() == (0, 3.2, 0, 0)


def test_segment_merge_key_and_length():
    s = Segment(a=1, b=2, coords=[(0, 0), (0, 1)], name="X", limits=Limits(max_draft=2))
    t = Segment(a=2, b=3, coords=[(0, 1), (0, 2)], name="X", limits=Limits(max_draft=2))
    assert s.merge_key() == t.merge_key()
    t.limits.max_width = 9
    assert s.merge_key() != t.merge_key()
    assert s.length == pytest.approx(haversine((0, 0), (0, 1)))
