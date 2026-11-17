"""Points of interest for the route itinerary: fuel, ports, marinas, slipways, water and sanitary stations."""
from __future__ import annotations

# Order matters: the first matching rule wins.
SERVICE_TAGS: list[tuple[str, str, str]] = [
    ("fuel", "waterway", "fuel"),
    ("fuel", "seamark:small_craft_facility:category", "fuel_station"),
    ("marina", "leisure", "marina"),
    ("port", "seamark:type", "harbour"),
    ("port", "landuse", "harbour"),
    ("port", "harbour", "yes"),
    ("slipway", "leisure", "slipway"),
    ("water", "waterway", "water_point"),
    ("sanitary", "waterway", "sanitary_dump_station"),
]


def poi_type(tags) -> str | None:
    """The itinerary category of an OSM object, or None. Multi-valued tags (a;b) match any value."""
    for kind, key, value in SERVICE_TAGS:
        v = tags.get(key)
        if v and value in v.split(";"):
            return kind
    if tags.get("amenity") == "fuel" and (tags.get("boat") == "yes" or tags.get("fuel:marine") == "yes"):
        return "fuel"
    return None
