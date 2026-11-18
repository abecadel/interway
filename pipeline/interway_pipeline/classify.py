"""Decides which OSM waterways are navigable for recreational/commercial boats."""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from pathlib import Path

import yaml

# flowline: the line of a river or fairway through a lake (Göta kanal through Vättern at Motala)
LINE_WATERWAYS = {"river", "canal", "fairway", "tidal_channel", "flowline"}
YES = {"yes", "designated", "permissive", "official"}
NO = {"no", "private"}
# water=lock areas are left out on purpose: a lock chamber joins two water levels, meshing it would bypass the lock
LAKE_WATER = {"lake", "reservoir", "lagoon", "basin", "oxbow", "river", "canal", "harbour", "bay"}


@dataclass
class Allowlist:
    names: set[str] = field(default_factory=set)
    wikidata: set[str] = field(default_factory=set)
    lakes: set[str] = field(default_factory=set)
    exclude_names: set[str] = field(default_factory=set)
    exclude_patterns: list[re.Pattern] = field(default_factory=list)

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
            al.exclude_patterns += [re.compile(p, re.IGNORECASE) for p in data.get("exclude_patterns", [])]
        return al

    def excluded(self, name: str | None) -> bool:
        if not name:
            return False
        return name.casefold() in self.exclude_names or any(p.search(name) for p in self.exclude_patterns)

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
    if allow.excluded(tags.get("name")):
        return False
    boat, ship, motor = tags.get("boat"), tags.get("ship"), tags.get("motorboat")
    if boat in NO and motor not in YES and ship not in YES:
        return False
    if ww in ("fairway", "tidal_channel"):
        return True
    if "CEMT" in tags or "cemt" in tags:
        return True
    # boat=yes alone is not enough: it also covers canoes and kayaks on small rivers
    if ship in YES or motor in YES:
        return True
    if tags.get("seamark:type") in ("fairway", "recommended_track", "navigation_line"):
        return True
    if tags.get("lock") == "yes":
        return True
    if tags.get("wikidata") in allow.wikidata:
        return True
    return allow.has_name(tags)


def is_connector_candidate(tags, allow: Allowlist) -> bool:
    """A river/canal without navigability evidence that may still link lakes (see topology.add_connectors).

    Applies the same hard exclusions as is_navigable_way: culverts, intermittent flow, boat=no and excluded names.
    """
    if tags.get("waterway") not in ("river", "canal"):
        return False
    if tags.get("tunnel") == "culvert" or tags.get("intermittent") == "yes" or tags.get("boat") in NO:
        return False
    return not allow.excluded(tags.get("name"))


CHANNEL_WATER = {"river", "canal", "harbour"}


def is_candidate_lake(tags) -> bool:
    if tags.get("natural") == "water":
        return tags.get("water", "lake") in LAKE_WATER and tags.get("intermittent") != "yes"
    return tags.get("landuse") == "reservoir" or tags.get("waterway") in ("dock", "riverbank")


def is_channel_area(tags) -> bool:
    """Water areas that are stretches of river or canal: kept at any size because they link waterways."""
    return tags.get("water") in CHANNEL_WATER or tags.get("waterway") == "riverbank"


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
    if ww in ("fairway", "tidal_channel", "flowline"):  # a flowline crosses still water: no current
        return "fairway"
    return "river"
