"""Charted depth for sea routes, from EMODnet Bathymetry (https://emodnet.ec.europa.eu, CC BY 4.0).

The European DTM has a ~115 m grid; it is fetched downsampled (WCS SCALEFACTOR) in 2° tiles, on demand, and
cached on disk. Values are elevations: negative below sea level. Sea mesh edges get a draft limit from the
shallowest point along them, so the router keeps deep-draught boats off banks and shoals. The grid smooths out
dredged channels and harbour entrances, so it is a planning aid, not a chart: not for navigation.
"""
from __future__ import annotations

import itertools
import logging
import math
import urllib.request
from pathlib import Path
from typing import Callable

import numpy as np

from .model import LonLat, Segment, haversine

log = logging.getLogger(__name__)

WCS = "https://ows.emodnet-bathymetry.eu/wcs"
TILE_DEG = 2  # larger requests are refused (HTTP 500) or resampled inconsistently by the service
ATTRIBUTION = "Bathymetry © EMODnet Bathymetry Consortium (CC BY 4.0)"
# lon/lat the DTM covers (European seas, the Atlantic to Iceland and the Azores): no requests outside it
COVERAGE = (-36.0, 15.0, 43.0, 90.0)
TIFF_MAGIC = (b"II*\x00", b"MM\x00*")


def tile_url(i: int, j: int, scale: float) -> str:
    w, s = i * TILE_DEG, j * TILE_DEG
    return (f"{WCS}?service=WCS&version=2.0.1&request=GetCoverage&CoverageId=emodnet__mean"
            f"&subset=Lat({s},{s + TILE_DEG})&subset=Long({w},{w + TILE_DEG})&format=image/tiff&SCALEFACTOR={scale}")


def tile_loader(cache_dir: Path, scale: float = 0.25,
                opener: Callable = urllib.request.urlopen) -> Callable[[int, int], np.ndarray | None]:
    """Loads tile (i, j) — lon 2i..2i+2, lat 2j..2j+2, north up — from the cache or the WCS service."""
    import tifffile

    def load(i: int, j: int) -> np.ndarray | None:
        w, s, e, n = COVERAGE
        if i * TILE_DEG >= e or (i + 1) * TILE_DEG <= w or j * TILE_DEG >= n or (j + 1) * TILE_DEG <= s:
            return None  # another continent: nothing to ask for
        f = cache_dir / f"emodnet_{i}_{j}_{scale}.tif"
        missing = f.with_suffix(".none")  # a tile the service had no data for: not asked again
        if missing.exists():
            return None
        if not f.exists():
            try:
                with opener(tile_url(i, j, scale), timeout=300) as r:
                    data = r.read()
            except OSError as e:  # the service is down or refused: try again next run
                log.warning("no depth tile %d,%d: %s", i, j, e)
                return None
            cache_dir.mkdir(parents=True, exist_ok=True)
            if not data.startswith(TIFF_MAGIC):  # an error page or empty coverage, not a GeoTIFF
                log.warning("no depth data in tile %d,%d", i, j)
                missing.write_bytes(b"")
                return None
            f.write_bytes(data)
        return tifffile.imread(f).astype(np.float32)

    return load


class DepthGrid:
    """Depth (m below sea level) at a point; None on land or where no data is known."""

    def __init__(self, load: Callable[[int, int], np.ndarray | None]) -> None:
        self._load = load
        self._tiles: dict[tuple[int, int], np.ndarray | None] = {}

    def depth(self, lon: float, lat: float) -> float | None:
        i, j = math.floor(lon / TILE_DEG), math.floor(lat / TILE_DEG)
        if (i, j) not in self._tiles:
            self._tiles[(i, j)] = self._load(i, j)
        a = self._tiles[(i, j)]
        if a is None:
            return None
        h, w = a.shape
        r = min(int(((j + 1) * TILE_DEG - lat) / TILE_DEG * h), h - 1)
        c = min(int((lon - i * TILE_DEG) / TILE_DEG * w), w - 1)
        v = float(a[r, c])
        return -v if v < 0 else None  # land pixels near the coast say nothing about the water

    def min_along(self, coords: list[LonLat], step_m: float = 500.0) -> float | None:
        ds = [d for p in samples(coords, step_m) if (d := self.depth(*p)) is not None]
        return min(ds, default=None)


def samples(coords: list[LonLat], step_m: float) -> list[LonLat]:
    """Points along a line, at most step_m apart, ends included."""
    out: list[LonLat] = []
    for a, b in itertools.pairwise(coords):
        n = max(1, math.ceil(haversine(a, b) / step_m))
        out += [(a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n) for k in range(n + 1)]
    return out


def apply_sea_depth(segments: list[Segment], grid: DepthGrid, *, near_land: Callable[[np.ndarray], np.ndarray] | None = None,
                    safety_m: float = 0.5, max_m: float = 30.0, step_m: float = 500.0) -> int:
    """Draft limits on sea segments shallower than max_m: the shallowest charted depth minus safety_m.

    near_land(lonlat points) masks samples next to the shore: there the coarse grid mixes land and water cells
    and reads almost zero everywhere, which says nothing about a harbour's dredged approach.
    """
    sea = [s for s in segments if s.kind == "sea"]
    pts = [samples(s.coords, step_m) for s in sea]
    flat = np.array([p for ps in pts for p in ps], dtype=float).reshape(-1, 2)
    skip = near_land(flat) if near_land is not None else np.zeros(len(flat), dtype=bool)
    limited, k = 0, 0
    for s, ps in zip(sea, pts, strict=True):
        ds = [d for i, p in enumerate(ps) if not skip[k + i] and (d := grid.depth(*p)) is not None]
        k += len(ps)
        d = min(ds, default=None)
        if d is not None and d < max_m:
            s.limits.max_draft = round(max(d - safety_m, 0.05), 2)  # 0 would mean "no limit"
            limited += 1
    log.info("charted depth limits on %d of %d sea segments", limited, len(sea))
    return limited
