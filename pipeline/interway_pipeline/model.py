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

    @property
    def length(self) -> float:
        return line_length(self.coords)

    def merge_key(self):
        return (self.name, self.kind, self.lock, self.oneway, self.flows, self.limits.as_tuple(),
                self.depth_unknown, self.offshore)


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
