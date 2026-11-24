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
# French names carry the article ("L'Yonne", "La Sarthe"); allowlists name the river without it
ARTICLE = re.compile(r"^(?:l['’]\s*|la\s+|le\s+|les\s+)", re.IGNORECASE)


def name_forms(v: str) -> tuple[str, ...]:
    """The casefolded name, and the name without a leading French article when it has one."""
    f = v.casefold()
    bare = ARTICLE.sub("", f, count=1)
    return (f, bare) if bare != f and bare else (f,)


LAKE_WATER = {"lake", "reservoir", "lagoon", "basin", "oxbow", "river", "canal", "harbour", "bay"}


@dataclass
class Allowlist:
    names: set[str] = field(default_factory=set)
    wikidata: set[str] = field(default_factory=set)
    lakes: set[str] = field(default_factory=set)
    # OSM way ids of river/canal ways navigable under a name too common to allowlist (Norway's many "Straumen")
    ways: set[int] = field(default_factory=set)
    # OSM way ids left out whatever their tags (the St. Lawrence through the Lachine and Soulanges rapids, which
    # the Seaway canals bypass)
    exclude_ways: set[int] = field(default_factory=set)
    # OSM node ids of dams and weirs boats pass: removed dams still mapped (the Illinois River's Copperas Creek Dam)
    passable_nodes: set[int] = field(default_factory=set)
    exclude_names: set[str] = field(default_factory=set)
    exclude_patterns: list[re.Pattern] = field(default_factory=list)
    # names navigable only in part: {name: [(w, s, e, n), ...]}, taken only where a way has a node inside a box
    bounded: dict[str, list[tuple[float, float, float, float]]] = field(default_factory=dict)

    @classmethod
    def load(cls, directory: Path | None) -> "Allowlist":
        al = cls()
        if directory is None or not directory.exists():
            return al
        for f in sorted(directory.glob("*.yaml")):
            data = yaml.safe_load(f.read_text(encoding="utf-8")) or {}
            for n in data.get("waterways", []):
                if isinstance(n, dict):  # {name, bbox}: a reach of a river navigable only in part
                    al.bounded.setdefault(n["name"].casefold(), []).append(tuple(map(float, n["bbox"])))
                else:
                    al.names.add(n.casefold())
            al.wikidata |= set(data.get("wikidata", []))
            al.lakes |= {n.casefold() for n in data.get("lakes", [])}
            al.ways |= {int(w) for w in data.get("ways", [])}
            al.exclude_ways |= {int(w) for w in data.get("exclude_ways", [])}
            al.passable_nodes |= {int(n) for n in data.get("passable_nodes", [])}
            al.exclude_names |= {n.casefold() for n in data.get("exclude", [])}
            al.exclude_patterns += [re.compile(p, re.IGNORECASE) for p in data.get("exclude_patterns", [])]
        return al

    def excluded(self, name: str | None) -> bool:
        if not name:
            return False
        return name.casefold() in self.exclude_names or any(p.search(name) for p in self.exclude_patterns)

    def has_name(self, tags) -> bool:
        return any(f in self.names for f in self._forms(tags))

    def boxes(self, tags) -> list[tuple[float, float, float, float]]:
        """The boxes of a name navigable only in part (empty for other names)."""
        return [b for f in self._forms(tags) for b in self.bounded.get(f, ())]

    @staticmethod
    def _forms(tags):
        for key in ("name", "name:pl", "name:de", "name:nl", "name:en", "name:fr", "official_name", "alt_name"):
            v = tags.get(key)
            if v:
                yield from name_forms(v)


def in_boxes(coords, boxes) -> bool:
    """Whether any of the (lon, lat) `coords` lies in one of the boxes."""
    return any(w <= x <= e and s <= y <= n for x, y in coords for w, s, e, n in boxes)


def is_navigable_way(tags, allow: Allowlist, coords=None) -> bool:
    """`coords` (the way's (lon, lat) nodes, or a callable giving them) are needed only for names navigable in part."""
    ww = tags.get("waterway")
    if ww not in LINE_WATERWAYS and not (ww == "stream" and ("CEMT" in tags or "cemt" in tags)):
        # a "stream" with a CEMT class is a mis-tagged navigable channel (the Labe's lock cuts at Štětí and Roudnice)
        return False
    if tags.get("tunnel") == "culvert" or tags.get("intermittent") == "yes":
        return False
    if allow.excluded(tags.get("name")):
        return False
    boat, ship, motor = tags.get("boat"), tags.get("ship"), tags.get("motorboat")
    if boat in NO and motor not in YES and ship not in YES:
        return False
    if ww in ("fairway", "tidal_channel"):
        # a paddling route drawn as a fairway (Finland's melontareitit, canoe=*, often through rapids) is no boat route,
        # unless the allowlist names it (New York's East River and Hell Gate carry canoe=yes and nothing else)
        paddling = "canoe" in tags and "seamark:type" not in tags and motor not in YES and ship not in YES
        return not paddling or _allowlisted(tags, allow, coords)
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
    if motor in NO:  # a name alone does not outweigh a ban on motorboats (side arms of the Loire above Bouchemaine)
        return False
    return _allowlisted(tags, allow, coords)


def _allowlisted(tags, allow: Allowlist, coords) -> bool:
    """Named in the allowlist: by wikidata, by name, or by a name limited to boxes the way lies in."""
    if tags.get("wikidata") in allow.wikidata or allow.has_name(tags):
        return True
    boxes = allow.boxes(tags) if coords is not None else []
    return bool(boxes) and in_boxes(coords() if callable(coords) else coords, boxes)


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
    # a lagoon may be mapped as a bay (the Curonian Lagoon: natural=bay + water=lagoon inside the coastline)
    if tags.get("natural") == "water" or (tags.get("natural") == "bay" and tags.get("water") == "lagoon"):
        return tags.get("water", "lake") in LAKE_WATER and tags.get("intermittent") != "yes"
    return tags.get("landuse") == "reservoir" or tags.get("waterway") in ("dock", "riverbank")


def is_channel_area(tags) -> bool:
    """Water areas that are stretches of river or canal: kept at any size because they link waterways."""
    return tags.get("water") in CHANNEL_WATER or tags.get("waterway") == "riverbank"


def lake_allowlisted(tags, allow: Allowlist) -> bool:
    for key in ("name", "name:pl", "name:de", "name:nl", "name:en", "name:fr"):
        v = tags.get(key)
        if v and any(f in allow.lakes or f in allow.names for f in name_forms(v)):
            return True
    return tags.get("wikidata") in allow.wikidata or tags.get("boat") in YES or tags.get("motorboat") in YES


def kind_of(tags) -> str:
    ww = tags.get("waterway")
    if ww == "canal":
        return "canal"
    if ww in ("fairway", "tidal_channel", "flowline"):  # a flowline crosses still water: no current
        return "fairway"
    return "river"
