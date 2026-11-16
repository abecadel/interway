"""Builds a tiny synthetic OSM file covering the pipeline's cases."""
from __future__ import annotations

from pathlib import Path
from xml.sax.saxutils import quoteattr

NODES = {
    # river "Narew" west of the reservoir, flowing east
    1: (20.00, 52.00), 2: (20.01, 52.00), 3: (20.02, 52.00), 4: (20.03, 52.00),
    # reservoir corners
    101: (20.03, 51.99), 102: (20.06, 51.99), 103: (20.06, 52.01), 104: (20.03, 52.01),
    # river east of the reservoir
    5: (20.06, 52.00), 6: (20.075, 52.00), 7: (20.09, 52.00),
    # canal north with a lock gate at 8
    8: (20.09, 52.015), 9: (20.09, 52.03),
    # river continues east through a weir at 10
    10: (20.10, 52.00), 11: (20.11, 52.00),
    # stream south (not navigable)
    12: (20.09, 51.98),
    # bridge across the canal
    201: (20.08, 52.02), 202: (20.10, 52.02),
    # tiny isolated canal
    301: (21.0, 53.0), 302: (21.001, 53.0),
}
NODE_TAGS = {8: {"waterway": "lock_gate", "name": "Śluza Testowa"}, 10: {"waterway": "weir"}}
WAYS = [
    (1, [1, 2, 3, 4], {"waterway": "river", "name": "Narew"}),
    (2, [5, 6, 7], {"waterway": "river", "name": "Narew"}),
    (3, [7, 8, 9], {"waterway": "canal", "name": "Kanał Testowy", "CEMT": "II"}),
    (4, [7, 10, 11], {"waterway": "river", "name": "Narew"}),
    (5, [7, 12], {"waterway": "stream", "name": "Struga"}),
    (100, [101, 102, 103, 104, 101], {"natural": "water", "water": "reservoir", "name": "Zalew Testowy"}),
    (200, [201, 202], {"highway": "primary", "bridge": "yes", "maxheight": "2.5"}),
    (300, [301, 302], {"waterway": "canal", "CEMT": "I"}),
]


def write_fixture(path: Path) -> Path:
    out = ['<?xml version="1.0" encoding="UTF-8"?>', '<osm version="0.6" generator="interway-tests">']
    for nid, (lon, lat) in NODES.items():
        tags = NODE_TAGS.get(nid)
        attrs = f'id="{nid}" version="1" lat="{lat}" lon="{lon}"'
        if tags:
            out.append(f"  <node {attrs}>")
            out += [f"    <tag k={quoteattr(k)} v={quoteattr(v)}/>" for k, v in tags.items()]
            out.append("  </node>")
        else:
            out.append(f"  <node {attrs}/>")
    for wid, nds, tags in WAYS:
        out.append(f'  <way id="{wid}" version="1">')
        out += [f'    <nd ref="{n}"/>' for n in nds]
        out += [f"    <tag k={quoteattr(k)} v={quoteattr(v)}/>" for k, v in tags.items()]
        out.append("  </way>")
    out.append("</osm>")
    path.write_text("\n".join(out), encoding="utf-8")
    return path
