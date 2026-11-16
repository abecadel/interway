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


def write_osm(path: Path, nodes: dict, ways: list, relations: list = (), node_tags: dict | None = None) -> Path:
    """Write an OSM XML file.

    nodes: {id: (lon, lat) or None}; None writes a node without a location.
    ways: [(id, [node refs], {tags})]; refs to ids missing from `nodes` produce invalid locations.
    relations: [(id, [(type, ref, role)], {tags})].
    """
    node_tags = node_tags or {}

    def tag_lines(tags):
        return [f"    <tag k={quoteattr(k)} v={quoteattr(v)}/>" for k, v in tags.items()]

    out = ['<?xml version="1.0" encoding="UTF-8"?>', '<osm version="0.6" generator="interway-tests">']
    for nid, loc in nodes.items():
        tags = node_tags.get(nid)
        attrs = f'id="{nid}" version="1"' + (f' lat="{loc[1]}" lon="{loc[0]}"' if loc is not None else "")
        if tags:
            out += [f"  <node {attrs}>", *tag_lines(tags), "  </node>"]
        else:
            out.append(f"  <node {attrs}/>")
    for wid, nds, tags in ways:
        out += [f'  <way id="{wid}" version="1">', *(f'    <nd ref="{n}"/>' for n in nds), *tag_lines(tags), "  </way>"]
    for rid, members, tags in relations:
        out.append(f'  <relation id="{rid}" version="1">')
        out += [f'    <member type="{t}" ref="{r}" role="{role}"/>' for t, r, role in members]
        out += [*tag_lines(tags), "  </relation>"]
    out.append("</osm>")
    path.write_text("\n".join(out), encoding="utf-8")
    return path


def write_fixture(path: Path) -> Path:
    return write_osm(path, NODES, WAYS, node_tags=NODE_TAGS)
