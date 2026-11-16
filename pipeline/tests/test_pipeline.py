import json
from pathlib import Path

import numpy as np
import pytest
from fixture import write_fixture

from interway_pipeline.cli import build
from interway_pipeline.model import DOWNSTREAM, GEOM_REVERSED, LAKE, LOCK, UPSTREAM, parse_metres


def read_graph(path: Path):
    b = path.read_bytes()
    assert b[:4] == b"IWG1"
    _, n, m, a = np.frombuffer(b, "<u4", 4, 4)
    pos = 20
    out = {}
    for name, dt, cnt in [("lat", "<i4", n), ("lon", "<i4", n), ("off", "<u4", n + 1), ("tgt", "<u4", m),
                          ("len", "<f4", m), ("geom", "<u4", m), ("attr", "<u2", m), ("flags", "<u2", m),
                          ("attrs", "<f4", a * 4)]:
        out[name] = np.frombuffer(b, dt, cnt, pos)
        pos += (out[name].nbytes + 3) & ~3
    assert pos == len(b)
    out["n"], out["m"] = int(n), int(m)
    return out


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    tmp = tmp_path_factory.mktemp("build")
    allow = tmp / "allow"
    allow.mkdir()
    (allow / "test.yaml").write_text("waterways: [Narew]\n", encoding="utf-8")
    osm = write_fixture(tmp / "fixture.osm")
    out = tmp / "out"
    manifest = build([osm], out, region="test", allowlist=allow, patches=None, min_component_km=1.0)
    return out, manifest, read_graph(out / "graph.bin")


def node_at(g, lon, lat):
    d = np.abs(g["lon"] / 1e7 - lon) + np.abs(g["lat"] / 1e7 - lat)
    i = int(np.argmin(d))
    assert d[i] < 1e-4, f"no node at {lon},{lat}"
    return i


def reachable(g, start):
    seen, stack = {start}, [start]
    while stack:
        u = stack.pop()
        for e in range(g["off"][u], g["off"][u + 1]):
            v = int(g["tgt"][e])
            if v not in seen:
                seen.add(v)
                stack.append(v)
    return seen


def test_parse_metres():
    assert parse_metres("3,5 m") == 3.5
    assert parse_metres("10 ft") == pytest.approx(3.048)
    assert parse_metres("default") == 0


def test_lake_connects_rivers_and_canal(built):
    _, _, g = built
    west = node_at(g, 20.00, 52.00)
    canal_end = node_at(g, 20.09, 52.03)
    assert canal_end in reachable(g, west)
    assert np.any(g["flags"] & LAKE)


def test_stream_and_weir_excluded(built):
    _, manifest, g = built
    names = manifest["names"]
    assert "Struga" not in names
    west = node_at(g, 20.00, 52.00)
    lons = {round(float(g["lon"][i]) / 1e7, 3) for i in reachable(g, west)}
    assert 20.11 not in lons  # behind the weir
    # the tiny isolated canal is dropped
    assert not np.any(np.isclose(g["lon"] / 1e7, 21.0))


def test_canal_has_lock_and_bridge_clearance(built):
    _, manifest, g = built
    lock_edges = np.nonzero(g["flags"] & LOCK)[0]
    assert len(lock_edges) == 2  # both directions
    attrs = g["attrs"].reshape(-1, 4)
    heights = attrs[g["attr"][lock_edges], 1]
    assert np.allclose(heights, 2.5)
    assert "Śluza Testowa" in manifest["names"]


def test_river_flow_direction(built):
    _, _, g = built
    river = (g["flags"] & (DOWNSTREAM | UPSTREAM)) != 0
    fwd = river & ((g["flags"] & GEOM_REVERSED) == 0)
    assert np.all(g["flags"][fwd] & DOWNSTREAM)
    assert np.all(g["flags"][river & ~fwd] & UPSTREAM)


def test_outputs(built):
    out, manifest, _ = built
    assert manifest["files"]["graph"] == "graph.bin"
    pois = json.loads((out / "pois.json").read_text(encoding="utf-8"))
    assert any(p["type"] == "lock" for p in pois)
    assert (out / "geom.bin").read_bytes()[:4] == b"IWS1"


def test_merge_keeps_junctions():
    from interway_pipeline.model import Segment
    from interway_pipeline.topology import components, merge_degree2

    def seg(a, b, x0, x1, name="X"):
        return Segment(a=a, b=b, coords=[(x0, 0.0), (x1, 0.0)], name=name, kind="canal")

    # chain 1-2-3-4 with a branch 3-5; merging 1-2-3 must not swallow junction 3
    segs = [seg(1, 2, 0, 1), seg(2, 3, 1, 2), seg(3, 4, 2, 3), seg(3, 5, 2, 2.5, name="Y")]
    out = merge_degree2(segs)
    assert len(set(components(out).values())) == 1
    ends = sorted({n for s in out for n in (s.a, s.b)})
    assert ends == [1, 3, 4, 5]
