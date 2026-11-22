import io

import numpy as np
import tifffile

from interway_pipeline.depth import TILE_DEG, DepthGrid, apply_sea_depth, tile_loader, tile_url
from interway_pipeline.model import Segment

# tile (7, 25): lon 14..16, lat 50..52, 10 x 10 cells of 0.2°, north up. Elevation: negative below sea.
TILE = np.full((10, 10), -40.0, dtype=np.float32)
TILE[0, :] = 5.0         # land along the northern edge (lat 51.8..52)
TILE[5, 4] = -2.0        # a bank at lat 50.8..51.0, lon 14.8..15.0
TILE[9, 9] = -1.0        # the south-east corner cell


def grid(**tiles):
    return DepthGrid(lambda i, j: tiles.get(f"t{i}_{j}"))


def test_tile_url():
    url = tile_url(7, 25, 0.25)
    assert "subset=Lat(50,52)" in url and "subset=Long(14,16)" in url and "SCALEFACTOR=0.25" in url


def test_depth_sign_orientation_and_unknowns():
    g = grid(t7_25=TILE)
    assert g.depth(14.1, 50.1) == 40.0
    assert g.depth(14.9, 50.9) == 2.0
    assert g.depth(14.1, 51.9) is None        # land pixel
    assert g.depth(5.0, 5.0) is None          # no tile there
    assert g.depth(14 + TILE_DEG - 1e-9, 50.0) == 1.0  # edges clamp into the tile


def test_min_along_and_limits():
    g = grid(t7_25=TILE)
    assert g.min_along([(14.05, 50.9), (15.95, 50.9)]) == 2.0  # crosses the bank
    assert g.min_along([(14.1, 51.9), (14.2, 51.9)]) is None  # land only
    sea = [
        Segment(a=1, b=2, coords=[(14.05, 50.9), (15.95, 50.9)], kind="sea"),     # bank: 2 m - 1 m margin
        Segment(a=2, b=3, coords=[(14.1, 50.3), (14.15, 50.3)], kind="sea"),      # 40 m: deeper than max_m
        Segment(a=3, b=4, coords=[(15.85, 50.01), (15.95, 50.02)], kind="sea"),   # 1 m: 0.05 floor
        Segment(a=4, b=5, coords=[(14.9, 50.9), (14.95, 50.9)], kind="river"),    # not sea
    ]
    off_the_map = Segment(a=6, b=7, coords=[(-70.1, 40.0), (-70.0, 40.0)], kind="sea")  # no tile: not charted
    land_only = Segment(a=8, b=9, coords=[(14.1, 51.9), (14.2, 51.9)], kind="sea")  # charted, just dry pixels
    sea += [off_the_map, land_only]
    assert apply_sea_depth(sea, g, safety_m=1.0) == 2
    assert apply_sea_depth(sea, g, safety_m=1.0, chunk=1) == 2  # the same in chunks of one segment
    assert [s.limits.max_draft for s in sea] == [1.0, 0.0, 0.05, 0.0, 0.0, 0.0]
    # deep water (40 m) is not "unknown"; only the segment outside the bathymetry is
    assert [s.depth_unknown for s in sea] == [False, False, False, False, True, False]


def test_samples_next_to_land_are_left_out():
    g = grid(t7_25=TILE)
    sea = [Segment(a=1, b=2, coords=[(14.05, 50.9), (15.95, 50.9)], kind="sea"),       # bank near "land" (lon < 15)
           Segment(a=2, b=3, coords=[(15.85, 50.01), (15.95, 50.02)], kind="sea")]     # 1 m, offshore
    assert apply_sea_depth(sea[1:], g, near_land=lambda p: p[:, 0] < 15.0) == 1
    assert sea[1].limits.max_draft == 0.5
    assert apply_sea_depth(sea[:1], g, near_land=lambda p: p[:, 0] < 15.0) == 0  # only 40 m water left


def test_tile_loader_caches_and_tolerates_failures(tmp_path):
    buf = io.BytesIO()
    tifffile.imwrite(buf, TILE)
    calls = []

    class Response(io.BytesIO):
        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    def opener(url, timeout):
        calls.append(url)
        if "Long(0," in url:
            raise OSError("404")
        if "Long(2," in url:
            return Response(b"<ExceptionReport>no coverage</ExceptionReport>")
        return Response(buf.getvalue())

    load = tile_loader(tmp_path / "tiles", 0.25, opener)
    assert np.array_equal(load(7, 25), TILE)
    assert np.array_equal(load(7, 25), TILE)  # from the cache
    assert len(calls) == 1
    assert load(0, 25) is None
    assert load(0, 25) is None  # a refused request is tried again next time
    assert sum("Long(0," in c for c in calls) == 2
    assert load(1, 25) is None and load(1, 25) is None  # not a GeoTIFF: remembered as empty, asked once
    assert sum("Long(2," in c for c in calls) == 1
    n = len(calls)
    # outside EMODnet (west, east, south, north of it): never asked
    assert load(-40, 20) is None and load(30, 20) is None and load(0, 5) is None and load(0, 50) is None
    assert len(calls) == n
