import pytest

from interway_pipeline.cli import itinerary_pois
from interway_pipeline.model import Limits, Segment, metres_to_deg
from interway_pipeline.pois import poi_type


@pytest.mark.parametrize("tags,expected", [
    ({"waterway": "fuel"}, "fuel"),
    ({"seamark:small_craft_facility:category": "slipway;fuel_station"}, "fuel"),
    ({"amenity": "fuel", "boat": "yes"}, "fuel"),
    ({"amenity": "fuel", "fuel:marine": "yes"}, "fuel"),
    ({"amenity": "fuel"}, None),  # a road petrol station
    ({"leisure": "marina"}, "marina"),
    ({"seamark:type": "harbour"}, "port"),
    ({"landuse": "harbour"}, "port"),
    ({"harbour": "yes"}, "port"),
    ({"leisure": "slipway"}, "slipway"),
    ({"waterway": "water_point"}, "water"),
    ({"waterway": "sanitary_dump_station"}, "sanitary"),
    ({"waterway": "river"}, None),
    ({}, None),
])
def test_poi_type(tags, expected):
    assert poi_type(tags) == expected


def test_itinerary_pois():
    m = metres_to_deg(1)
    canal = Segment(a=1, b=2, coords=[(0.0, 0.0), (0.01, 0.0)], kind="canal")
    lock = Segment(a=2, b=3, coords=[(0.01, 0.0), (0.0101, 0.0)], kind="canal", lock=True, name="Śluza",
                   limits=Limits(max_length=57.4, max_width=9.6))
    plain_lock = Segment(a=3, b=4, coords=[(0.02, 0.0), (0.0201, 0.0)], kind="canal", lock=True)
    services = [("fuel", "Stacja", (0.005, 500 * m)), ("marina", "Daleko", (0.005, 1500 * m))]
    pois = itinerary_pois([canal, lock, plain_lock], services, [((0.003, 0.0), 3.2)])
    assert {"type": "lock", "name": "Śluza", "lon": pytest.approx(0.01, abs=1e-3), "lat": 0.0,
            "maxlength": 57.4, "maxwidth": 9.6} in pois
    assert any(p["type"] == "lock" and "maxlength" not in p for p in pois)
    assert {"type": "bridge", "name": "", "lon": 0.003, "lat": 0.0, "clearance": 3.2} in pois
    assert [p["name"] for p in pois if p["type"] == "fuel"] == ["Stacja"]  # 500 m from the canal
    assert not any(p["type"] == "marina" for p in pois)  # 1.5 km away
    assert itinerary_pois([], services, []) == []
