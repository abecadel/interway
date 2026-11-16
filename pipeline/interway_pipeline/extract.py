"""Reads an OSM file (.pbf/.osm) and collects everything the graph builder needs."""
from __future__ import annotations

import logging
import math
from dataclasses import dataclass, field
from pathlib import Path

import osmium
from shapely.geometry import LineString, MultiPolygon, Polygon

from .classify import Allowlist, is_candidate_lake, is_navigable_way, kind_of, lake_allowlisted
from .model import LonLat, parse_metres

log = logging.getLogger(__name__)

TAG_KEYS = (
    "name", "waterway", "lock", "lock_name", "oneway", "maxdraft", "draft", "maxheight", "maxwidth",
    "maxlength", "CEMT", "seamark:type",
)


@dataclass
class NavWay:
    id: int
    nodes: list[int]
    coords: list[LonLat]
    tags: dict[str, str]


@dataclass
class Lake:
    id: int
    name: str
    polygon: Polygon | MultiPolygon
    allowlisted: bool


@dataclass
class Extract:
    ways: list[NavWay] = field(default_factory=list)
    lock_nodes: set[int] = field(default_factory=set)
    barrier_nodes: set[int] = field(default_factory=set)
    lock_names: dict[int, str] = field(default_factory=dict)
    lakes: list[Lake] = field(default_factory=list)
    bridges: list[tuple[LineString, float]] = field(default_factory=list)
    marinas: list[tuple[str, LonLat]] = field(default_factory=list)
    # river/canal ways without navigability evidence; short ones may link lakes (see topology.add_connectors)
    connectors: list[NavWay] = field(default_factory=list)
    timestamp: str = ""


def _ring(ring) -> list[LonLat]:
    return [(n.lon, n.lat) for n in ring]


def _area_polygon(area) -> Polygon | MultiPolygon | None:
    polys = []
    for outer in area.outer_rings():
        shell = _ring(outer)
        if len(shell) < 4:
            continue
        holes = [_ring(inner) for inner in area.inner_rings(outer)]
        p = Polygon(shell, [h for h in holes if len(h) >= 4])
        if not p.is_valid:
            p = p.buffer(0)
        if not p.is_empty:
            polys.append(p)
    if not polys:
        return None
    return polys[0] if len(polys) == 1 else MultiPolygon([g for p in polys for g in getattr(p, "geoms", [p])])


def read_osm(path: Path, allow: Allowlist, min_lake_km2: float = 0.05) -> Extract:
    ex = Extract()
    try:
        reader = osmium.io.Reader(str(path), osmium.osm.osm_entity_bits.NOTHING)
        ex.timestamp = reader.header().get("osmosis_replication_timestamp", "")
        reader.close()
    except Exception:  # noqa: BLE001 - header is optional
        pass

    area_filter = osmium.filter.KeyFilter("natural", "landuse", "waterway", "leisure")
    fp = osmium.FileProcessor(str(path)).with_locations().with_areas(area_filter)
    n_ways = 0
    for o in fp:
        tags = o.tags
        if o.is_node():
            ww = tags.get("waterway")
            if ww == "lock_gate" or tags.get("lock") == "yes" or tags.get("seamark:type") == "gate":
                ex.lock_nodes.add(o.id)
                if "name" in tags:
                    ex.lock_names[o.id] = tags.get("name")
            elif ww in ("weir", "dam", "waterfall") and tags.get("lock") != "yes":
                ex.barrier_nodes.add(o.id)
            if tags.get("leisure") == "marina" and o.location.valid():
                ex.marinas.append((tags.get("name", ""), (o.lon, o.lat)))
        elif o.is_way():
            n_ways += 1
            if is_navigable_way(tags, allow):
                try:
                    coords = [(n.lon, n.lat) for n in o.nodes]
                except osmium.InvalidLocationError:
                    continue
                if len(coords) >= 2:
                    kept = {k: tags.get(k) for k in TAG_KEYS if k in tags}
                    ex.ways.append(NavWay(o.id, [n.ref for n in o.nodes], coords, kept))
                    ex.ways[-1].tags["kind"] = kind_of(tags)
            elif tags.get("waterway") in ("river", "canal") and tags.get("boat") not in ("no", "private") \
                    and tags.get("tunnel") != "culvert" and len(o.nodes) < 400:
                try:
                    coords = [(n.lon, n.lat) for n in o.nodes]
                except osmium.InvalidLocationError:
                    continue
                kept = {k: tags.get(k) for k in TAG_KEYS if k in tags}
                kept["kind"] = kind_of(tags)
                ex.connectors.append(NavWay(o.id, [n.ref for n in o.nodes], coords, kept))
            elif "bridge" in tags and tags.get("bridge") != "no":
                h = parse_metres(tags.get("seamark:bridge:clearance_height") or tags.get("maxheight:physical")
                                 or tags.get("maxheight"))
                if h > 0:
                    try:
                        ex.bridges.append((LineString([(n.lon, n.lat) for n in o.nodes]), h))
                    except (osmium.InvalidLocationError, ValueError):
                        pass
        elif o.is_area():
            if tags.get("leisure") == "marina":
                poly = _area_polygon(o)
                if poly is not None:
                    c = poly.representative_point()
                    ex.marinas.append((tags.get("name", ""), (c.x, c.y)))
                continue
            if not is_candidate_lake(tags):
                continue
            poly = _area_polygon(o)
            if poly is None:
                continue
            # rough km² at mid-latitude, enough for a size threshold
            lat = poly.centroid.y
            km2 = poly.area * 111.32 * 111.32 * max(0.1, math.cos(math.radians(lat)))
            allowed = lake_allowlisted(tags, allow)
            if km2 >= min_lake_km2 or allowed:
                ex.lakes.append(Lake(o.id, tags.get("name", ""), poly, allowed))
    log.info("read %d ways: %d navigable, %d connector candidates, %d lakes, %d bridges w/ clearance, %d lock nodes, %d marinas",
             n_ways, len(ex.ways), len(ex.connectors), len(ex.lakes), len(ex.bridges), len(ex.lock_nodes), len(ex.marinas))
    return ex
