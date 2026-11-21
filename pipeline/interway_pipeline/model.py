"""Shared data structures and helpers."""
from __future__ import annotations

import math
from dataclasses import dataclass, field

EARTH_R = 6371008.8
MIN_LAKE_KM2 = 0.05  # water areas below this are kept only when they are river/canal stretches

# Edge flags, see docs/graph-format.md
LOCK = 1 << 0
LAKE = 1 << 1
DOWNSTREAM = 1 << 2
UPSTREAM = 1 << 3
SEA = 1 << 4
GEOM_REVERSED = 1 << 5
CANAL = 1 << 6
PATCH = 1 << 7
NO_DEPTH = 1 << 8  # open sea without charted depth (outside the bathymetry's coverage)
OFFSHORE = 1 << 9  # open sea far from the coast: a small boat keeping near the coast avoids it
NO_MOTOR = 1 << 10  # OSM says motorboats are not allowed (motorboat=no, boat=no on the way or the lake)
SPEED_SHIFT = 11  # bits 11-15: posted speed limit in km/h (1-31; 0 = none known, 31 = 31 or more)
MAX_SPEED_KMH = 31

KNOT_KMH = 1.852
MPH_KMH = 1.609344

LonLat = tuple[float, float]


def haversine(a: LonLat, b: LonLat) -> float:
    lon1, lat1 = map(math.radians, a)
    lon2, lat2 = map(math.radians, b)
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return 2 * EARTH_R * math.asin(min(1.0, math.sqrt(h)))


def line_length(coords: list[LonLat]) -> float:
    return sum(haversine(coords[i - 1], coords[i]) for i in range(1, len(coords)))


def area_km2(poly) -> float:
    """Rough area of a lon/lat polygon in km² (equirectangular at its centroid), enough for size thresholds."""
    return poly.area * 111.32 * 111.32 * max(0.1, math.cos(math.radians(poly.centroid.y)))


def metres_to_deg(m: float) -> float:
    return m / 111_320.0


@dataclass
class Limits:
    """0 = unknown / unlimited."""
    max_draft: float = 0.0
    max_height: float = 0.0
    max_width: float = 0.0
    max_length: float = 0.0

    def as_tuple(self) -> tuple[float, float, float, float]:
        return (self.max_draft, self.max_height, self.max_width, self.max_length)

    def tighten_height(self, h: float) -> None:
        if h > 0 and (self.max_height == 0 or h < self.max_height):
            self.max_height = h


@dataclass
class Segment:
    """An undirected piece of waterway between two graph nodes.

    `a`/`b` are node keys (OSM node ids, or negative synthetic ids). `coords[0]` is at `a`.
    """
    a: int
    b: int
    coords: list[LonLat]
    name: str = ""
    kind: str = "river"  # river | canal | fairway | lake | sea | patch
    lock: bool = False
    oneway: bool = False
    flows: bool = False  # True: drawing direction a->b is downstream
    limits: Limits = field(default_factory=Limits)
    osm_way: int = 0
    depth_unknown: bool = False  # sea segment with no charted depth along it
    offshore: bool = False  # sea segment whose middle is far from land (see sea.mark_offshore)
    no_motor: bool = False  # motorboats not allowed (OSM motorboat=no or boat=no)
    max_speed: int = 0  # posted speed limit, km/h (0 = none known)

    @property
    def length(self) -> float:
        return line_length(self.coords)

    def merge_key(self):
        return (self.name, self.kind, self.lock, self.oneway, self.flows, self.limits.as_tuple(),
                self.depth_unknown, self.offshore, self.no_motor, self.max_speed)


def parse_speed(value: str | None) -> int:
    """Parse OSM maxspeed values for boats ('10', '5 knots', '6 kn', '3 mph') to whole km/h, 0 when unknown."""
    if not value:
        return 0
    v = value.strip().lower().split(";")[0]
    factor = KNOT_KMH if any(u in v for u in ("knot", "kn", "kt")) else MPH_KMH if "mph" in v else 1.0
    num = "".join(c for c in v.split()[0] if c.isdigit() or c in ".,").replace(",", ".") if v.split() else ""
    try:
        x = float(num) * factor
    except ValueError:
        return 0
    return min(MAX_SPEED_KMH, max(1, int(x + 0.5))) if x > 0 else 0


def access_of(tags: dict[str, str]) -> tuple[bool, int]:
    """(motorboats not allowed, posted speed limit km/h) from a waterway's or a lake's tags."""
    motor, boat = tags.get("motorboat"), tags.get("boat")
    no_motor = motor in ("no", "private") or (boat in ("no", "private") and motor not in ("yes", "designated", "permissive"))
    return no_motor, parse_speed(tags.get("maxspeed:boat") or tags.get("maxspeed"))


def parse_metres(value: str | None) -> float:
    """Parse OSM length values like '3.5', '3,5 m', '12 ft'. Returns 0 when unknown."""
    if not value:
        return 0.0
    v = value.strip().lower().replace(",", ".")
    factor = 1.0
    if v.endswith("ft") or v.endswith("'"):
        factor = 0.3048
        v = v.rstrip("ft'").strip()
    v = v.removesuffix("m").strip()
    try:
        x = float(v.split(";")[0]) * factor
    except ValueError:
        return 0.0
    return x if 0 < x < 1000 else 0.0
