"""Points of interest for the route itinerary: fuel, ports, marinas, slipways, water and sanitary stations, and the
towns a route passes."""
from __future__ import annotations

from pathlib import Path

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


# GeoNames feature codes that are not towns of their own: districts (Lyon 01, Sector 1, the arrondissements
# of Marseille) and historical or abandoned places
NOT_TOWNS = {"PPLX", "PPLA5", "PPLH", "PPLQ", "PPLW"}


def load_places(path: Path) -> list[tuple[str, str, tuple[float, float]]]:
    """Towns from a GeoNames table (cities5000.txt, CC BY 4.0): ("place", name, (lon, lat)) per row."""
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        cols = line.split("\t")
        if len(cols) > 5 and cols[1] and (len(cols) < 8 or cols[7] not in NOT_TOWNS):
            out.append(("place", cols[1], (float(cols[5]), float(cols[4]))))
    return out
