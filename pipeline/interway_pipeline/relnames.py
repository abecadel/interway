"""Names for unnamed waterway lines from the relations they belong to.

A navigation route relation (e.g. "Saint Lawrence Seaway", type=route with ship/boat=yes) or a waterway relation
often carries the only name of its fairway lines across a lake. Read in a pass of its own, cached apart from the
extract, so adding it re-reads no extract.
"""
from __future__ import annotations

import hashlib
import json
import logging
from pathlib import Path

import osmium

from .extract import Extract

log = logging.getLogger(__name__)
RELNAMES_VERSION = 1  # bump when read_relation_names output changes, invalidates --cache


def _rank(tags) -> int | None:
    """How specific a relation's name is for its member lines (lower wins); None when it names no waterway."""
    if not tags.get("name"):
        return None
    kind = tags.get("type")
    if kind == "route" and tags.get("route") in (None, "boat", "canoe") and \
            (tags.get("route") or tags.get("ship") == "yes" or tags.get("boat") == "yes"):
        return 0
    if kind == "waterway":
        return 1
    return None


def read_relation_names(path: Path) -> dict[int, str]:
    """way id -> name of the most specific named navigation route or waterway relation it is a member of."""
    best: dict[int, tuple[int, str]] = {}
    for rel in osmium.FileProcessor(str(path), osmium.osm.RELATION):
        tags = dict(rel.tags)
        rank = _rank(tags)
        if rank is None:
            continue
        for m in rel.members:
            if m.type == "w" and (m.ref not in best or rank < best[m.ref][0]):
                best[m.ref] = (rank, tags["name"])
    return {w: name for w, (_, name) in best.items()}


def cached_relation_names(path: Path, cache_dir: Path | None) -> dict[int, str]:
    if cache_dir is None:
        return read_relation_names(path)
    st = path.stat()
    key = hashlib.sha256(repr((str(path.resolve()), st.st_size, st.st_mtime, RELNAMES_VERSION)).encode()).hexdigest()[:16]
    f = cache_dir / f"{path.name}.{key}.relnames.json"
    if f.exists():
        return {int(k): v for k, v in json.loads(f.read_text()).items()}
    names = read_relation_names(path)
    cache_dir.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps(names))
    return names


def name_from_relations(ex: Extract, names: dict[int, str]) -> int:
    """Gives unnamed navigable ways and connectors their relation's name; returns how many were named."""
    n = 0
    for w in [*ex.ways, *ex.connectors]:
        if not w.tags.get("name") and w.id in names:
            w.tags["name"] = names[w.id]
            n += 1
    log.info("named %d ways from their relations", n)
    return n
