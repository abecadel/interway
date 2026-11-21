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
    services = [("fuel", "Stacja", (0.005, 500 * m), (("phone", "+48 1"),)), ("marina", "Daleko", (0.005, 1500 * m), ())]
    pois = itinerary_pois([canal, lock, plain_lock], services, [((0.003, 0.0), 3.2)])
    assert {"type": "lock", "name": "Śluza", "lon": pytest.approx(0.01, abs=1e-3), "lat": 0.0,
            "maxlength": 57.4, "maxwidth": 9.6} in pois
    assert any(p["type"] == "lock" and "maxlength" not in p for p in pois)
    assert {"type": "bridge", "name": "", "lon": 0.003, "lat": 0.0, "clearance": 3.2} in pois
    assert [(p["name"], p["phone"]) for p in pois if p["type"] == "fuel"] == [("Stacja", "+48 1")]  # 500 m from the canal
    assert not any(p["type"] == "marina" for p in pois)  # 1.5 km away
    assert itinerary_pois([], services, []) == []



def test_load_places(tmp_path):
    from interway_pipeline.pois import load_places
    f = tmp_path / "cities.txt"
    f.write_text("3083829\tToruń\tTorun\tThorn\t53.01375\t18.59814\tP\tPPLA\tPL\n\nbad\n4\t\tx\t\t1\t2\n", encoding="utf-8")
    assert load_places(f) == [("place", "Toruń", (18.59814, 53.01375), (("cc", "PL"),))]
    f.write_text("1\tLyon\tx\t\t45.75\t4.85\tP\tPPLA\n", encoding="utf-8")  # no country column
    assert load_places(f) == [("place", "Lyon", (4.85, 45.75), ())]


def test_port_info_takes_the_first_tag_found_and_keeps_it_short():
    from interway_pipeline.pois import port_info
    info = dict(port_info({"contact:website": "https://a.example", "url": "https://b.example", "depth": "2.5",
                           "operator": "x" * 200, "drinking_water": "yes", "toilets": "no", "shower": "designated"}))
    assert info == {"website": "https://a.example", "depth": "2.5", "operator": "x" * 120, "services": "water, showers"}
    assert port_info({}) == ()


def test_load_places_skips_districts(tmp_path):
    from interway_pipeline.pois import load_places
    f = tmp_path / "cities.txt"
    f.write_text("1\tLyon 01\tx\t\t45.77\t4.83\tP\tPPLX\tFR\n2\tMarseille 01\tx\t\t43.3\t5.38\tP\tPPLA5\tFR\n"
                 "3\tLyon\tx\t\t45.75\t4.85\tP\tPPLA\tFR\n", encoding="utf-8")
    assert [n for _, n, _, _ in load_places(f)] == ["Lyon"]
