import io

import numpy as np
import tifffile

from interway_pipeline.depth import TILE_DEG, DepthGrid, apply_sea_depth, tile_loader, tile_url
from interway_pipeline.model import Segment

# tile (3, 10): lon 15..20, lat 50..55, 10 x 10 cells of 0.5°, north up. Elevation: negative below sea.
TILE = np.full((10, 10), -40.0, dtype=np.float32)
TILE[0, :] = 5.0         # land along the northern edge (lat 54.5..55)
TILE[5, 4] = -2.0        # a bank at lat 52..52.5, lon 17..17.5
TILE[9, 9] = -1.0        # the south-east corner cell


def grid(**tiles):
    return DepthGrid(lambda i, j: tiles.get(f"t{i}_{j}"))


def test_tile_url():
    url = tile_url(3, 10, 0.25)
    assert "subset=Lat(50,55)" in url and "subset=Long(15,20)" in url and "SCALEFACTOR=0.25" in url


def test_depth_sign_orientation_and_unknowns():
    g = grid(t3_10=TILE)
    assert g.depth(15.1, 50.1) == 40.0
    assert g.depth(17.2, 52.3) == 2.0
    assert g.depth(15.1, 54.9) is None        # land pixel
    assert g.depth(5.0, 5.0) is None          # no tile there
    assert g.depth(15 + TILE_DEG - 1e-9, 50.0) == 1.0  # edges clamp into the tile


def test_min_along_and_limits():
    g = grid(t3_10=TILE)
    assert g.min_along([(15.1, 52.2), (19.9, 52.2)]) == 2.0  # crosses the bank
    assert g.min_along([(15.1, 54.9), (15.2, 54.9)]) is None  # land only
    sea = [
        Segment(a=1, b=2, coords=[(15.1, 52.2), (19.9, 52.2)], kind="sea"),       # bank: 2 m - 0.5
        Segment(a=2, b=3, coords=[(15.1, 51.0), (15.2, 51.0)], kind="sea"),       # 40 m: deeper than max_m
        Segment(a=3, b=4, coords=[(19.95, 50.01), (19.99, 50.02)], kind="sea"),   # 1 m: 0.05 floor
        Segment(a=4, b=5, coords=[(17.2, 52.3), (17.3, 52.3)], kind="river"),     # not sea
    ]
    assert apply_sea_depth(sea, g, safety_m=1.0) == 2
    assert [s.limits.max_draft for s in sea] == [1.0, 0.0, 0.05, 0.0]


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
        return Response(buf.getvalue())

    load = tile_loader(tmp_path / "tiles", 0.25, opener)
    assert np.array_equal(load(3, 10), TILE)
    assert np.array_equal(load(3, 10), TILE)  # from the cache
    assert len(calls) == 1
    assert load(0, 0) is None
