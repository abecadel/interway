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

import dataclasses
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
    # Porsgrunn to the Skagerrak, the Telemark Canal's way to the sea: Brevikstrømmen is about 300 m wide
    "Frierfjord": (9.55, 58.97, 9.80, 59.14),
    # the Limfjord's sounds (1-2 km wide): with the coarse mesh the way through depends on the triangulation,
    # and Aalborg → Thyborøn went round Skagen when Sallingsund lost its edges
    "Aggersund": (9.25, 56.96, 9.36, 57.03),
    "Vilsund": (8.60, 56.84, 8.70, 56.92),
    "Sallingsund": (8.72, 56.63, 8.95, 56.80),
    "Hvalpsund": (9.15, 56.66, 9.24, 56.73),
    "Oddesund": (8.50, 56.55, 8.62, 56.61),
    # Santa Teresa Gallura's harbour inlet (Porto Longone), about 300 m wide
    "Porto Longone": (9.18, 41.23, 9.22, 41.26),
    # Croatia: the Pelješac channel east of Korčula town (about 1.3 km wide; without it Korčula -> Mljet went
    # round the whole island), St. Anthony's channel into Šibenik and the Krka (about 200 m), and the Rijeka
    # Dubrovačka up to ACI Komolac (300-500 m)
    "Pelješac channel": (17.08, 42.92, 17.32, 43.00),
    "St. Anthony's channel": (15.85, 43.71, 15.92, 43.76),
    "Rijeka Dubrovačka": (18.06, 42.64, 18.14, 42.68),
    # the Schlei, a 40 km fjord from Schleimünde to Schleswig, 150 m wide at Missunde
    "Schlei": (9.55, 54.48, 10.05, 54.70),
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
    def load(cls, path: Path, bbox: tuple[float, float, float, float] | list = DEFAULT_BBOX, simplify_m: float = 50.0) -> "Coast":
        """Land polygons in `bbox`, or in each of a list of bboxes (each split polygon loaded once)."""
        import shapefile  # pyshp, only needed when building sea routes

        boxes = [bbox] if isinstance(bbox, tuple) else list(bbox)
        seen: set[int] = set()
        polys = []
        with shapefile.Reader(str(path)) as r:
            for box in boxes:
                for s in r.iterShapes(bbox=box):
                    if s.oid not in seen:  # boxes that overlap share split polygons
                        seen.add(s.oid)
                        polys.append(shapely.geometry.shape(s.__geo_interface__))
        polys = shapely.simplify(np.asarray(polys, dtype=object), metres_to_deg(simplify_m), preserve_topology=True)
        log.info("loaded %d land polygons in %s", len(polys), boxes)
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

    def land_length(self, line) -> float:
        """Metres of `line` over land."""
        hits = self.tree.query(line, predicate="intersects")
        return float(shapely.intersection(line, shapely.union_all(self.land[hits])).length) if len(hits) else 0.0

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


# Cruising grounds full of islands and narrow channels (refine areas) get a finer coast, a denser offshore grid
# and edges that skip a node where the straight line stays in water: a coarse mesh makes short passages there
# 30-150 % too long (zigzags between the shores of a sound, detours round islands).
REFINE_COAST = 1 / 3  # coast step factor
REFINE_OFFSET = 0.4  # coast offset factor
REFINE_GRID = 0.4  # offshore grid factor
REFINE_CLEAR = 0.5  # offshore clearance factor
REFINE_BAND_M = 6000.0  # the finer grid and the skipping edges only this close to land (Mercator m)


def _inside(pts: np.ndarray, boxes: list) -> np.ndarray:
    """Mask of Mercator points inside any of the lon/lat `boxes`."""
    mask = np.zeros(len(pts), dtype=bool)
    for b in boxes:
        (x0, y0), (x1, y1) = to_merc(np.array([b[:2], b[2:]]))
        mask |= (pts[:, 0] >= x0) & (pts[:, 0] <= x1) & (pts[:, 1] >= y0) & (pts[:, 1] <= y1)
    return mask


def _two_hop(coast: Coast, edges: np.ndarray, keep: np.ndarray) -> np.ndarray:
    """Lines between nodes two `edges` apart, both ends in `keep` (Mercator xy rows), that touch no land."""
    if not len(edges) or not len(keep):
        return np.zeros(0, dtype=object)
    ends = shapely.get_coordinates(edges).reshape(-1, 2, 2)
    keys = {tuple(p) for p in map(tuple, keep)}
    nb: dict[tuple, set] = {}
    for a, b in map(lambda e: (tuple(e[0]), tuple(e[1])), ends):
        nb.setdefault(a, set()).add(b)
        nb.setdefault(b, set()).add(a)
    pairs = {(min(a, c), max(a, c)) for a in nb if a in keys for b in nb[a] for c in nb[b]
             if c != a and c in keys and c not in nb[a]}
    if not pairs:
        return np.zeros(0, dtype=object)
    lines = shapely.linestrings(np.array(sorted(pairs)))
    return lines[~coast.crossing(lines)]


def sea_mesh(coast: Coast, bbox: tuple[float, float, float, float] = DEFAULT_BBOX, *, coast_step_m: float = 3000.0,
             coast_offset_m: float = 500.0, grid_m: float = 25000.0, grid_clear_m: float = 3000.0,
             max_offshore_m: float = 400000.0, narrows: dict | None = None, areas: list[dict] | None = None) -> list[Segment]:
    """Segments (kind "sea") of a mesh over the water in `bbox`. Distances are Mercator metres (true metres
    times 1/cos(latitude)). Each `narrows` bbox gets extra coast points at a sixth of the spacing and offset.

    `areas` ({"bbox": (w, s, e, n)} with an optional "max_offshore_m" each) replaces `bbox`: the areas are
    meshed together on one offshore grid anchored at the first area's corner, so areas that touch or overlap
    join up, and an area far from others (another continent) forms its own part. Areas marked "refine" lie
    inside the others and make the mesh finer there (see REFINE_COAST); a refine area's own "grid_m" sets its
    offshore spacing (for a strait narrower than the usual fine grid)."""
    areas = areas or [{"bbox": bbox}]
    fine_areas = [a for a in areas if a.get("refine")]
    refine = [a["bbox"] for a in fine_areas]
    areas = [a for a in areas if not a.get("refine")]
    coast_pts = np.vstack([_coast_points(coast, a["bbox"], coast_step_m, coast_offset_m) for a in areas])
    for area in (NARROWS if narrows is None else narrows).values():
        coast_pts = np.vstack([coast_pts, _coast_points(coast, area, coast_step_m / 6, coast_offset_m / 6)])
    for area in refine:
        coast_pts = np.vstack([coast_pts, _coast_points(coast, area, coast_step_m * REFINE_COAST,
                                                        coast_offset_m * REFINE_OFFSET)])
    x0, y0 = to_merc(np.array([areas[0]["bbox"][:2]]))[0]
    coast_tree = STRtree(shapely.points(coast_pts)) if len(coast_pts) else None

    grids = []
    for area in areas:
        (ax0, ay0), (ax1, ay1) = to_merc(np.array([area["bbox"][:2], area["bbox"][2:]]))
        # lattice indices covering the area (for the first area: exactly arange(x0, x1, grid_m))
        gx, gy = np.meshgrid(x0 + np.arange(np.ceil((ax0 - x0) / grid_m), np.ceil((ax1 - x0) / grid_m)) * grid_m,
                             y0 + np.arange(np.ceil((ay0 - y0) / grid_m), np.ceil((ay1 - y0) / grid_m)) * grid_m)
        grid = np.column_stack([gx.ravel(), gy.ravel()])
        grid = grid[~coast.near_land(grid, grid_clear_m)]
        if coast_tree is not None and len(grid):
            idx, _ = coast_tree.query_nearest(shapely.points(grid), max_distance=area.get("max_offshore_m", max_offshore_m),
                                              return_distance=True, all_matches=False)
            grid = grid[np.unique(idx[0])]
        grids.append(grid)
    fine_m = grid_m * REFINE_GRID
    for spec in fine_areas:
        area, step = spec["bbox"], spec.get("grid_m", fine_m)
        (ax0, ay0), (ax1, ay1) = to_merc(np.array([area[:2], area[2:]]))
        gx, gy = np.meshgrid(np.arange(ax0, ax1, step), np.arange(ay0, ay1, step))
        fine = np.column_stack([gx.ravel(), gy.ravel()])
        fine = fine[coast.near_land(fine, REFINE_BAND_M) & ~coast.near_land(fine, grid_clear_m * REFINE_CLEAR)]
        grids.append(fine)
    grid = grids[0] if len(grids) == 1 else np.unique(np.vstack(grids), axis=0)
    if len(areas) > 1 or refine:
        coast_pts = np.unique(coast_pts, axis=0)  # overlapping areas find the same coast points
    nodes = np.vstack([coast_pts, grid])
    if len(nodes) < 3:
        return []

    edges = shapely.get_parts(shapely.delaunay_triangles(MultiPoint(nodes), only_edges=True))
    edges = edges[shapely.length(edges) <= 3 * grid_m]
    edges = np.concatenate([edges, _grid_moves(grid, x0, y0, grid_m)])
    edges = edges[~coast.crossing(edges)]
    if refine:
        near = nodes[_inside(nodes, refine)]
        edges = np.concatenate([edges, _two_hop(coast, edges, near[coast.near_land(near, REFINE_BAND_M)])])

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


def mark_offshore(sea: list[Segment], coast: Coast, km: float = 10.0) -> int:
    """Flag sea segments whose middle is more than `km` (true distance) from land: a small boat that keeps near
    the coast, from harbour to harbour, avoids them. Returns how many were flagged."""
    if not sea:
        return 0
    mid = np.array([((s.coords[0][0] + s.coords[-1][0]) / 2, (s.coords[0][1] + s.coords[-1][1]) / 2) for s in sea])
    merc = to_merc(mid)
    # Mercator stretches distances by 1/cos(latitude): compare in Mercator metres at each segment's latitude
    limit = km * 1000 / np.cos(np.radians(mid[:, 1]))
    near = np.zeros(len(sea), dtype=bool)
    idx, _ = coast.tree.query_nearest(shapely.points(merc), max_distance=float(limit.max()), return_distance=True,
                                      all_matches=False)
    if len(idx[0]):
        d = shapely.distance(shapely.points(merc[idx[0]]), coast.land[idx[1]])
        near[idx[0][d <= limit[idx[0]]]] = True
    for s, n in zip(sea, near, strict=True):
        s.offshore = not n
    flagged = int((~near).sum())
    log.info("%d of %d sea segments are offshore (more than %.0f km from land)", flagged, len(sea), km)
    return flagged


def drop_sheltered(sea: list[Segment], sheltered: list, inset_m: float = 100.0) -> list[Segment]:
    """The mesh without edges that touch a node inside `sheltered` (lon/lat polygons of lakes and lagoons that
    have their own lake mesh, shrunk by `inset_m` Mercator metres). Water the coastline leaves open (the
    Lithuanian half of the Curonian Lagoon) is then crossed on the lake mesh, not as open sea."""
    if not sea or not sheltered:
        return sea
    # one polygon at a time: a union of thousands of detailed lakes takes too much memory
    polys = np.array([shapely.transform(p, to_merc) for p in sheltered], dtype=object)
    pos = node_positions(sea)
    ids = list(pos)
    pts = shapely.points(to_merc(np.array([pos[i] for i in ids])))
    pi, li = STRtree(polys).query(pts, predicate="within")
    deep = shapely.distance(pts[pi], shapely.boundary(polys[li])) > inset_m
    gone = {ids[k] for k in pi[deep].tolist()}
    kept = [s for s in sea if s.a not in gone and s.b not in gone]
    log.info("dropped %d sea mesh edges inside %d sheltered waters", len(sea) - len(kept), len(sheltered))
    return kept


SPLIT_IN_SEA_M = 5000.0  # a waterway line running through sea water gets a node this often, for connect_to_sea


def split_in_sea(segments: list[Segment], coast: Coast, every_m: float = SPLIT_IN_SEA_M) -> list[Segment]:
    """Splits river, canal and fairway lines at a vertex in sea water about every `every_m`, so that
    connect_to_sea can join them to the mesh along the way, not only at their ends: the Gulf Intracoastal
    Waterway is one 165 km line through Santa Rosa Sound and Choctawhatchee Bay. Returns the new list."""
    out: list[Segment] = []
    split = 0
    for s in segments:
        if s.kind not in ("river", "canal", "fairway") or s.lock or len(s.coords) < 3:
            out.append(s)
            continue
        merc = to_merc(np.array(s.coords))
        wet = ~coast.on_land(shapely.points(merc))
        step = np.hypot(*np.diff(merc, axis=0).T)
        cuts, run = [], 0.0
        for i in range(1, len(s.coords) - 1):
            run += step[i - 1]
            if wet[i] and run >= every_m:
                cuts.append(i)
                run = 0.0
        if not cuts:
            out.append(s)
            continue
        ends = [s.a] + [new_node_id() for _ in cuts] + [s.b]
        bounds = [0, *cuts, len(s.coords) - 1]
        out += [dataclasses.replace(s, a=ends[k], b=ends[k + 1], coords=s.coords[bounds[k]:bounds[k + 1] + 1],
                                    limits=dataclasses.replace(s.limits)) for k in range(len(bounds) - 1)]
        split += 1
    log.info("split %d waterway lines in sea water for links to the mesh", split)
    return out


def connect_to_sea(segments: list[Segment], sea: list[Segment], coast: Coast, *, max_link_m: float = 8000.0,
                   mouth_m: float = 150.0, links: int = 2, slack_m: float = 50.0) -> list[Segment]:
    """Links (kind "sea") from inland nodes to the mesh: nodes lying in sea water (estuaries, fairways,
    harbours), and dead ends inside land but within `mouth_m` of the sea (rivers ending at the coastline).
    A link must stay in water except within `mouth_m` of the inland node; beyond that it may cross up to
    `slack_m` of land, the error of the simplified coastline (the moles at the mouth of the Corinth Canal)."""
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
            if line.is_empty or not coast.crossing(np.array([line]))[0] or coast.land_length(line) <= slack_m:
                out.append(Segment(a=ids[k], b=sea_ids[j], coords=[pos[ids[k]], sea_pos[sea_ids[j]]], kind="sea"))
                made += 1
                if made == links:
                    break
    log.info("joined %d inland nodes to the sea mesh with %d links", len({s.a for s in out}), len(out))
    return out
