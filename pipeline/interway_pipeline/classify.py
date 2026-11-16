"""Decides which OSM waterways are navigable for recreational/commercial boats."""
from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import yaml

LINE_WATERWAYS = {"river", "canal", "fairway", "tidal_channel"}
YES = {"yes", "designated", "permissive", "official"}
NO = {"no", "private"}
LAKE_WATER = {"lake", "reservoir", "lagoon", "basin", "oxbow", "river", "canal", "harbour", "lock", "bay"}


@dataclass
class Allowlist:
    names: set[str] = field(default_factory=set)
    wikidata: set[str] = field(default_factory=set)
    lakes: set[str] = field(default_factory=set)
    exclude_names: set[str] = field(default_factory=set)

    @classmethod
    def load(cls, directory: Path | None) -> "Allowlist":
        al = cls()
        if directory is None or not directory.exists():
            return al
        for f in sorted(directory.glob("*.yaml")):
            data = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
            al.names |= {n.casefold() for n in data.get("waterways", [])}
            al.wikidata |= set(data.get("wikidata", []))
            al.lakes |= {n.casefold() for n in data.get("lakes", [])}
            al.exclude_names |= {n.casefold() for n in data.get("exclude", [])}
        return al

    def has_name(self, tags) -> bool:
        for key in ("name", "name:pl", "name:de", "name:nl", "name:en", "official_name", "alt_name"):
            v = tags.get(key)
            if v and v.casefold() in self.names:
                return True
        return False


def is_navigable_way(tags, allow: Allowlist) -> bool:
    ww = tags.get("waterway")
    if ww not in LINE_WATERWAYS:
        return False
    if tags.get("tunnel") == "culvert" or tags.get("intermittent") == "yes":
        return False
    name = (tags.get("name") or "").casefold()
    if name and name in allow.exclude_names:
        return False
    boat, ship, motor = tags.get("boat"), tags.get("ship"), tags.get("motorboat")
    if boat in NO and motor not in YES and ship not in YES:
        return False
    if ww in ("fairway", "tidal_channel"):
        return True
    if "CEMT" in tags or "cemt" in tags:
        return True
    if ship in YES or boat in YES or motor in YES:
        return True
    if tags.get("seamark:type") in ("fairway", "recommended_track", "navigation_line"):
        return True
    if tags.get("lock") == "yes":
        return True
    if tags.get("wikidata") in allow.wikidata:
        return True
    return allow.has_name(tags)


def is_candidate_lake(tags) -> bool:
    if tags.get("natural") == "water":
        return tags.get("water", "lake") in LAKE_WATER and tags.get("intermittent") != "yes"
    return tags.get("landuse") == "reservoir" or tags.get("waterway") == "dock"


def lake_allowlisted(tags, allow: Allowlist) -> bool:
    for key in ("name", "name:pl", "name:de", "name:nl", "name:en"):
        v = tags.get(key)
        if v and (v.casefold() in allow.lakes or v.casefold() in allow.names):
            return True
    return tags.get("wikidata") in allow.wikidata or tags.get("boat") in YES or tags.get("motorboat") in YES


def kind_of(tags) -> str:
    ww = tags.get("waterway")
    if ww == "canal":
        return "canal"
    if ww in ("fairway", "tidal_channel"):
        return "fairway"
    return "river"
