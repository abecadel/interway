"""Sea routing: a mesh over coastal seas built from OSM land polygons, joined to the inland network.

Land polygons (https://osmdata.openstreetmap.de, "land-polygons-split-4326") cover everything that is not sea,
inland lakes and rivers included. The mesh is built in Web Mercator metres so buffers and spacing behave the
same in every direction:

* coast nodes: points on the land buffered by `coast_offset_m`, at most one per `coast_step_m` cell, kept only
  where they really lie in open water (split-polygon seams fall inside the neighbouring tile and are dropped);
* grid nodes: a regular grid offshore, at least `grid_clear_m` from land and within `max_offshore_m` of the coast;
* edges: the Delaunay triangulation of all nodes, minus every edge that touches land.

Inland waterways join the mesh where their nodes lie in sea water (estuaries, fairways, harbours) or where a
river ends at the coastline; the link must stay in water except right at the inland node.
"""
from __future__ import annotations

import logging
from pathlib import Path

import numpy as np
import shapely
from shapely import STRtree
from shapely.geometry import LineString, MultiPoint, Point

from .model import Segment, metres_to_deg
from .topology import new_node_id, node_positions

log = logging.getLogger(__name__)

R = 6378137.0
# Baltic (to the Bothnian Bay), North Sea, Channel, Biscay, Iberia, Mediterranean, Black Sea
DEFAULT_BBOX = (-11.0, 30.0, 42.0, 66.0)
# Straits narrower than the default coast offset allows (bbox, lon/lat): meshed again with finer spacing.
NARROWS = {
    "Bosphorus": (28.95, 40.98, 29.20, 41.26),
    "Dardanelles": (26.15, 39.98, 26.75, 40.48),
}


def to_merc(xy: np.ndarray) -> np.ndarray:
    lon, lat = xy[:, 0], np.clip(xy[:, 1], -85.0, 85.0)
    return np.column_stack([np.radians(lon) * R, np.log(np.tan(np.pi / 4 + np.radians(lat) / 2)) * R])


def from_merc(xy: np.ndarray) -> np.ndarray:
    return np.column_stack([np.degrees(xy[:, 0] / R), np.degrees(2 * np.arctan(np.exp(xy[:, 1] / R)) - np.pi / 2)])


class Coast:
    """Land polygons in Mercator metres with a spatial index."""

    def __init__(self, land_lonlat: list) -> None:
        self.land = shapely.transform(np.asarray(land_lonlat, dtype=object), to_merc)
        self.tree = STRtree(self.land)

    @classmethod
    def load(cls, path: Path, bbox: tuple[float, float, float, float] = DEFAULT_BBOX, simplify_m: float = 50.0) -> "Coast":
        import shapefile  # pyshp, only needed when building sea routes

        with shapefile.Reader(str(path)) as r:
            polys = [shapely.geometry.shape(s.__geo_interface__) for s in r.iterShapes(bbox=bbox)]
        polys = shapely.simplify(np.asarray(polys, dtype=object), metres_to_deg(simplify_m), preserve_topology=True)
        log.info("loaded %d land polygons in %s", len(polys), bbox)
        return cls(list(polys))

    def near_land(self, pts: np.ndarray, dist: float) -> np.ndarray:
        """Mask of Mercator points closer than `dist` to land (inside counts as distance 0)."""
        if not len(pts):
            return np.zeros(0, dtype=bool)
        idx, _ = self.tree.query_nearest(shapely.points(pts), max_distance=dist, return_distance=True, all_matches=False)
        mask = np.zeros(len(pts), dtype=bool)
        mask[idx[0]] = True
        return mask

    def on_land(self, pts: np.ndarray) -> np.ndarray:
        """Mask of Mercator points inside or on land."""
        mask = np.zeros(len(pts), dtype=bool)
        if len(pts):
            mask[np.unique(self.tree.query(pts, predicate="intersects")[0])] = True
        return mask

    def covers(self, geom) -> bool:
        """Whether land (all split tiles together) covers `geom` completely."""
        hits = self.tree.query(geom, predicate="intersects")
        return bool(len(hits)) and shapely.union_all(self.land[hits]).covers(geom)

    def crossing(self, lines: np.ndarray) -> np.ndarray:
        """Mask of Mercator lines that touch land."""
        mask = np.zeros(len(lines), dtype=bool)
        if len(lines):
            mask[np.unique(self.tree.query(lines, predicate="intersects")[0])] = True
        return mask


def _thin(pts: np.ndarray, cell: float) -> np.ndarray:
    """At most one point per `cell` x `cell` square."""
    if not len(pts):
        return pts
    _, first = np.unique(np.floor(pts / cell).astype(np.int64), axis=0, return_index=True)
    return pts[np.sort(first)]


def _coast_points(coast: Coast, bbox, step: float, offset: float) -> np.ndarray:
    """Points `offset` off the coast inside `bbox`, at most one per `step` cell, at least offset/2 from land."""
    (x0, y0), (x1, y1) = to_merc(np.array([[bbox[0], bbox[1]], [bbox[2], bbox[3]]]))
    land = coast.land[coast.tree.query(shapely.box(x0, y0, x1, y1))]
    rings = shapely.boundary(shapely.buffer(shapely.simplify(land, step / 4), offset, quad_segs=2))
    pts = _thin(shapely.get_coordinates(shapely.segmentize(rings, step / 2)), step) if len(rings) else np.zeros((0, 2))
    pts = pts[(pts[:, 0] >= x0) & (pts[:, 0] <= x1) & (pts[:, 1] >= y0) & (pts[:, 1] <= y1)]
    return pts[~coast.near_land(pts, offset / 2)]


# Offshore grid moves in 16 directions (straight, diagonal and knight's moves): a square grid's triangulation
# alone allows only 4-6 directions, turning open-water crossings into staircases (Biscay ~40 % too long); with
# these a straight course is matched within ~3 %.
GRID_MOVES = ((1, 0), (0, 1), (1, 1), (1, -1), (2, 1), (1, 2), (2, -1), (1, -2))


def _grid_moves(grid: np.ndarray, x0: float, y0: float, step: float) -> np.ndarray:
    """Lines between grid nodes one move apart (the grid has holes where land or the coast is near)."""
    if not len(grid):
        return np.zeros(0, dtype=object)
    ij = np.rint((grid - [x0, y0]) / step).astype(np.int64)
    at = {(int(i), int(j)): k for k, (i, j) in enumerate(ij)}
    pairs = [(k, at[(i + di, j + dj)]) for k, (i, j) in enumerate(map(tuple, ij)) for di, dj in GRID_MOVES
             if (i + di, j + dj) in at]
    if not pairs:
        return np.zeros(0, dtype=object)
    a, b = np.array(pairs).T
    return shapely.linestrings(np.stack([grid[a], grid[b]], axis=1))


def sea_mesh(coast: Coast, bbox: tuple[float, float, float, float] = DEFAULT_BBOX, *, coast_step_m: float = 3000.0,
             coast_offset_m: float = 500.0, grid_m: float = 25000.0, grid_clear_m: float = 3000.0,
             max_offshore_m: float = 400000.0, narrows: dict | None = None) -> list[Segment]:
    """Segments (kind "sea") of a mesh over the water in `bbox`. Distances are Mercator metres (true metres
    times 1/cos(latitude)). Each `narrows` bbox gets extra coast points at a sixth of the spacing and offset."""
    coast_pts = _coast_points(coast, bbox, coast_step_m, coast_offset_m)
    for area in (NARROWS if narrows is None else narrows).values():
        coast_pts = np.vstack([coast_pts, _coast_points(coast, area, coast_step_m / 6, coast_offset_m / 6)])
    (x0, y0), (x1, y1) = to_merc(np.array([[bbox[0], bbox[1]], [bbox[2], bbox[3]]]))

    gx, gy = np.meshgrid(np.arange(x0, x1, grid_m), np.arange(y0, y1, grid_m))
    grid = np.column_stack([gx.ravel(), gy.ravel()])
    grid = grid[~coast.near_land(grid, grid_clear_m)]
    if len(coast_pts) and len(grid):
        idx, _ = STRtree(shapely.points(coast_pts)).query_nearest(
            shapely.points(grid), max_distance=max_offshore_m, return_distance=True, all_matches=False)
        grid = grid[np.unique(idx[0])]
    nodes = np.vstack([coast_pts, grid])
    if len(nodes) < 3:
        return []

    edges = shapely.get_parts(shapely.delaunay_triangles(MultiPoint(nodes), only_edges=True))
    edges = edges[shapely.length(edges) <= 3 * grid_m]
    edges = np.concatenate([edges, _grid_moves(grid, x0, y0, grid_m)])
    edges = edges[~coast.crossing(edges)]

    ids: dict[tuple[float, float], int] = {}
    seen: set[tuple[int, int]] = set()
    out: list[Segment] = []
    for e in edges:
        (ax, ay), (bx, by) = shapely.get_coordinates(e)
        a = ids.setdefault((ax, ay), new_node_id())
        b = ids.setdefault((bx, by), new_node_id())
        if (min(a, b), max(a, b)) in seen:
            continue  # a grid move that the triangulation already has
        seen.add((min(a, b), max(a, b)))
        lonlat = from_merc(np.array([[ax, ay], [bx, by]]))
        out.append(Segment(a=a, b=b, coords=[tuple(lonlat[0]), tuple(lonlat[1])], kind="sea"))
    log.info("sea mesh: %d coast + %d offshore nodes, %d edges", len(coast_pts), len(grid), len(out))
    return out


def drop_sheltered(sea: list[Segment], sheltered: list, inset_m: float = 100.0) -> list[Segment]:
    """The mesh without edges that touch a node inside `sheltered` (lon/lat polygons of lakes and lagoons that
    have their own lake mesh, shrunk by `inset_m` Mercator metres). Water the coastline leaves open (the
    Lithuanian half of the Curonian Lagoon) is then crossed on the lake mesh, not as open sea."""
    if not sea or not sheltered:
        return sea
    mask = shapely.buffer(shapely.union_all([shapely.transform(p, to_merc) for p in sheltered]), -inset_m)
    pos = node_positions(sea)
    ids = list(pos)
    inside = shapely.contains_xy(mask, *to_merc(np.array([pos[i] for i in ids])).T)
    gone = {i for i, x in zip(ids, inside, strict=True) if x}
    kept = [s for s in sea if s.a not in gone and s.b not in gone]
    log.info("dropped %d sea mesh edges inside %d sheltered waters", len(sea) - len(kept), len(sheltered))
    return kept


def connect_to_sea(segments: list[Segment], sea: list[Segment], coast: Coast, *, max_link_m: float = 8000.0,
                   mouth_m: float = 150.0, links: int = 2) -> list[Segment]:
    """Links (kind "sea") from inland nodes to the mesh: nodes lying in sea water (estuaries, fairways,
    harbours), and dead ends inside land but within `mouth_m` of the sea (rivers ending at the coastline).
    A link must stay in water except within `mouth_m` of the inland node."""
    if not sea or not segments:
        return []
    pos = node_positions(segments)
    degree: dict[int, int] = {}
    for s in segments:
        degree[s.a] = degree.get(s.a, 0) + 1
        degree[s.b] = degree.get(s.b, 0) + 1
    ids = list(pos)
    merc = to_merc(np.array([pos[i] for i in ids]))
    on_land = coast.on_land(shapely.points(merc))
    candidates = [k for k in range(len(ids))
                  if not on_land[k] or (degree[ids[k]] == 1 and not coast.covers(Point(merc[k]).buffer(mouth_m, quad_segs=4)))]
    sea_pos = node_positions(sea)
    sea_ids = list(sea_pos)
    sea_merc = to_merc(np.array([sea_pos[i] for i in sea_ids]))
    sea_tree = STRtree(shapely.points(sea_merc))
    out: list[Segment] = []
    for k in candidates:
        p = merc[k]
        near = sorted(sea_tree.query(Point(p).buffer(max_link_m)), key=lambda j: float(np.hypot(*(sea_merc[j] - p))))
        made = 0
        for j in near:
            line = shapely.difference(LineString([p, sea_merc[j]]), Point(p).buffer(mouth_m))
            if line.is_empty or not coast.crossing(np.array([line]))[0]:
                out.append(Segment(a=ids[k], b=sea_ids[j], coords=[pos[ids[k]], sea_pos[sea_ids[j]]], kind="sea"))
                made += 1
                if made == links:
                    break
    log.info("joined %d inland nodes to the sea mesh with %d links", len({s.a for s in out}), len(out))
    return out
