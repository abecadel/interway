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
    # for anglers: fishing spots and tackle shops; wrecks, obstructions and fish farms (structure to fish, and hazards)
    ("fishing", "leisure", "fishing"),
    ("tackle", "shop", "fishing"),
    ("wreck", "seamark:type", "wreck"),
    ("obstruction", "seamark:type", "obstruction"),
    ("fishfarm", "seamark:type", "marine_farm"),
    ("fishfarm", "landuse", "aquaculture"),
]
FISHING_KINDS = {"fishing", "tackle", "wreck", "obstruction", "fishfarm"}


def poi_type(tags) -> str | None:
    """The itinerary category of an OSM object, or None. Multi-valued tags (a;b) match any value."""
    for kind, key, value in SERVICE_TAGS:
        v = tags.get(key)
        if v and value in v.split(";"):
            return kind
    if tags.get("amenity") == "fuel" and (tags.get("boat") == "yes" or tags.get("fuel:marine") == "yes"):
        return "fuel"
    return None


# What OSM records about a harbour, marina or fuel berth, by the field the app shows (first tag found wins)
PORT_FIELDS: list[tuple[str, tuple[str, ...]]] = [
    ("website", ("website", "contact:website", "url")),
    ("phone", ("phone", "contact:phone")),
    ("email", ("email", "contact:email")),
    ("vhf", ("vhf", "seamark:radio_station:channel", "communication:vhf")),
    ("berths", ("capacity", "seamark:small_craft_facility:capacity")),
    ("boatlength", ("maxlength",)),
    ("depth", ("maxdraft", "depth")),
    ("hours", ("opening_hours",)),
    ("operator", ("operator",)),
]
PORT_SERVICES = [("diesel", "fuel:diesel"), ("petrol", "fuel:octane_95"), ("electricity", "power_supply"),
                 ("water", "drinking_water"), ("toilets", "toilets"), ("showers", "shower")]


def port_info(tags) -> tuple[tuple[str, str], ...]:
    """Facts about a port from its OSM tags, as sorted (field, value) pairs (hashable, for de-duplication)."""
    out = {}
    for field, keys in PORT_FIELDS:
        v = next((tags.get(k) for k in keys if tags.get(k)), None)
        if v:
            out[field] = v[:120]
    services = [label for label, key in PORT_SERVICES if tags.get(key) in ("yes", "designated")]
    if services:
        out["services"] = ", ".join(services)
    return tuple(sorted(out.items()))


# GeoNames feature codes that are not towns of their own: districts (Lyon 01, Sector 1, the arrondissements
# of Marseille) and historical or abandoned places
NOT_TOWNS = {"PPLX", "PPLA5", "PPLH", "PPLQ", "PPLW"}


def load_places(path: Path) -> list[tuple[str, str, tuple[float, float]]]:
    """Towns from a GeoNames table (cities5000.txt, CC BY 4.0): ("place", name, (lon, lat), (("cc", code),)) per row;
    the code (ISO 3166, column 9) tells the app whose notices to skippers apply along a route."""
    out = []
    for line in path.read_text(encoding="utf-8").splitlines():
        cols = line.split("\t")
        if len(cols) > 5 and cols[1] and (len(cols) < 8 or cols[7] not in NOT_TOWNS):
            country = (("cc", cols[8]),) if len(cols) > 8 and cols[8] else ()
            out.append(("place", cols[1], (float(cols[5]), float(cols[4])), country))
    return out
