"""Reads an OSM file (.pbf/.osm) and collects everything the graph builder needs."""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from pathlib import Path

import osmium
import shapely
from shapely.geometry import LineString, MultiPolygon, Point, Polygon

from .classify import (
    Allowlist,
    is_candidate_lake,
    is_channel_area,
    is_connector_candidate,
    is_navigable_way,
    kind_of,
    lake_allowlisted,
)
from .model import MIN_LAKE_KM2, LonLat, area_km2, parse_metres
from .pois import poi_type

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
    # "lake" (meshed for crossing) or "channel" (a river/canal stretch mapped as an area: used only where a
    # waterway dead-ends into it, see lakes._useful)
    kind: str = "lake"


@dataclass
class Extract:
    ways: list[NavWay] = field(default_factory=list)
    lock_nodes: set[int] = field(default_factory=set)
    barrier_nodes: set[int] = field(default_factory=set)
    lock_names: dict[int, str] = field(default_factory=dict)
    lakes: list[Lake] = field(default_factory=list)
    # (name, polygon) of lock chambers mapped as water=lock areas; see topology.mark_lock_areas
    lock_areas: list[tuple[str, Polygon | MultiPolygon]] = field(default_factory=list)
    bridges: list[tuple[LineString, float]] = field(default_factory=list)
    marinas: list[tuple[str, LonLat]] = field(default_factory=list)
    # (category, name, position) for the itinerary: fuel, marina, port, slipway, water, sanitary
    services: list[tuple[str, str, LonLat]] = field(default_factory=list)
    # river/canal ways without navigability evidence; short ones may link lakes (see topology.add_connectors)
    connectors: list[NavWay] = field(default_factory=list)
    # weirs and dams (points and lines): river/canal areas are not crossed over them, see lakes.connect_lakes
    weirs: list = field(default_factory=list)
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
            # not buffer(0): that keeps only one lobe of a self-intersecting (figure-eight) ring
            p = shapely.make_valid(p, method="structure", keep_collapsed=False)
        if not p.is_empty:
            polys.append(p)
    if not polys:
        return None
    return polys[0] if len(polys) == 1 else MultiPolygon([g for p in polys for g in getattr(p, "geoms", [p])])


def _way_coords(way) -> list[LonLat] | None:
    """Node locations of a way, or None when the extract lacks one of its nodes (ways cut at the border)."""
    try:
        return [(n.lon, n.lat) for n in way.nodes]
    except osmium.InvalidLocationError:
        return None


def read_osm(path: Path, allow: Allowlist, min_lake_km2: float = MIN_LAKE_KM2) -> Extract:
    ex = Extract()
    try:
        reader = osmium.io.Reader(str(path), osmium.osm.osm_entity_bits.NOTHING)
        ex.timestamp = reader.header().get("osmosis_replication_timestamp", "")
        reader.close()
    except Exception:  # noqa: BLE001 - header is optional
        pass

    area_filter = osmium.filter.KeyFilter("natural", "landuse", "waterway", "leisure", "seamark:type", "harbour")
    fp = osmium.FileProcessor(str(path)).with_locations().with_areas(area_filter)
    n_ways = 0
    for o in fp:
        tags = o.tags
        if o.is_node():
            ww = tags.get("waterway")
            # storm-surge barriers (Thames Barrier) stand open: mapped as gates, but not locks
            flood_gate = (tags.get("man_made") == "storm_surge_barrier"
                          or tags.get("seamark:gate:category") in ("flood_barrage", "flood_barrier"))
            if (ww == "lock_gate" or tags.get("lock") == "yes" or tags.get("seamark:type") == "gate") and not flood_gate:
                ex.lock_nodes.add(o.id)
                if "name" in tags:
                    ex.lock_names[o.id] = tags.get("name")
            elif ww in ("weir", "dam", "waterfall") and tags.get("lock") != "yes":
                ex.barrier_nodes.add(o.id)
                if o.location.valid():
                    ex.weirs.append(Point(o.lon, o.lat))
            kind = poi_type(tags)
            if kind and o.location.valid():
                ex.services.append((kind, tags.get("name", ""), (o.lon, o.lat)))
                if kind == "marina":
                    ex.marinas.append((tags.get("name", ""), (o.lon, o.lat)))
        elif o.is_way():
            n_ways += 1
            if is_navigable_way(tags, allow):
                coords = _way_coords(o)
                if coords is not None and len(coords) >= 2:
                    kept = {k: tags.get(k) for k in TAG_KEYS if k in tags}
                    kept["kind"] = kind_of(tags)
                    ex.ways.append(NavWay(o.id, [n.ref for n in o.nodes], coords, kept))
            elif is_connector_candidate(tags, allow) and len(o.nodes) < 400:
                coords = _way_coords(o)
                if coords is not None:
                    kept = {k: tags.get(k) for k in TAG_KEYS if k in tags}
                    kept["kind"] = kind_of(tags)
                    ex.connectors.append(NavWay(o.id, [n.ref for n in o.nodes], coords, kept))
            elif tags.get("waterway") in ("weir", "dam") and tags.get("lock") != "yes":
                coords = _way_coords(o)
                if coords is not None and len(coords) >= 2:
                    ex.weirs.append(LineString(coords))
            elif "bridge" in tags and tags.get("bridge") not in ("no", "movable"):
                # Only seamark clearance describes the space *under* a bridge. maxheight on a bridge way is the
                # limit for traffic on it, and movable bridges open for boats.
                h = parse_metres(tags.get("seamark:bridge:clearance_height"))
                coords = _way_coords(o) if h > 0 else None
                if coords is not None and len(coords) >= 2:
                    ex.bridges.append((LineString(coords), h))
        elif o.is_area():
            kind = poi_type(tags)
            if kind:
                poly = _area_polygon(o)
                if poly is not None:
                    c = poly.representative_point()
                    ex.services.append((kind, tags.get("name", ""), (c.x, c.y)))
                    if kind == "marina":
                        ex.marinas.append((tags.get("name", ""), (c.x, c.y)))
                continue
            if tags.get("water") == "lock":
                poly = _area_polygon(o)
                if poly is not None:
                    ex.lock_areas.append((tags.get("name", ""), poly))
                continue
            if not is_candidate_lake(tags):
                continue
            poly = _area_polygon(o)
            if poly is None:
                continue
            # rough km² at mid-latitude, enough for a size threshold
            km2 = area_km2(poly)
            allowed = lake_allowlisted(tags, allow)
            if is_channel_area(tags):
                ex.lakes.append(Lake(o.id, tags.get("name", ""), poly, allowed, kind="channel"))
            elif km2 >= min_lake_km2 or allowed:
                ex.lakes.append(Lake(o.id, tags.get("name", ""), poly, allowed))
    log.info("read %d ways: %d navigable, %d connector candidates, %d lakes, %d bridges w/ clearance, %d lock nodes, %d marinas",
             n_ways, len(ex.ways), len(ex.connectors), len(ex.lakes), len(ex.bridges), len(ex.lock_nodes), len(ex.marinas))
    return ex
