import pytest

from interway_pipeline.classify import (
    Allowlist,
    is_candidate_lake,
    is_connector_candidate,
    is_navigable_way,
    kind_of,
    lake_allowlisted,
)


@pytest.fixture
def allow():
    return Allowlist(names={"narew"}, wikidata={"Q123"}, lakes={"śniardwy"}, exclude_names={"rów melioracyjny"})


def test_allowlist_load_missing(tmp_path):
    assert Allowlist.load(None) == Allowlist()
    assert Allowlist.load(tmp_path / "nope") == Allowlist()


def test_allowlist_load_merges_files(tmp_path):
    (tmp_path / "a.yaml").write_text("waterways: [Narew, BUG]\nwikidata: [Q1]\n", encoding="utf-8")
    (tmp_path / "b.yaml").write_text("lakes: [Śniardwy]\nexclude: [Rów]\nwikidata: [Q2]\n", encoding="utf-8")
    (tmp_path / "empty.yaml").write_text("", encoding="utf-8")
    (tmp_path / "ignored.txt").write_text("waterways: [Odra]\n", encoding="utf-8")
    al = Allowlist.load(tmp_path)
    assert al.names == {"narew", "bug"}
    assert al.wikidata == {"Q1", "Q2"}
    assert al.lakes == {"śniardwy"}
    assert al.exclude_names == {"rów"}


def test_has_name_checks_alternative_keys(allow):
    assert allow.has_name({"name:de": "NAREW"})
    assert allow.has_name({"name": "Narwia", "alt_name": "Narew"})
    assert not allow.has_name({"name": "Odra", "name:en": "Oder"})
    assert not allow.has_name({})


@pytest.mark.parametrize("tags", [
    {"waterway": "stream", "boat": "yes"},
    {"waterway": "river", "tunnel": "culvert", "CEMT": "II"},
    {"waterway": "canal", "intermittent": "yes", "CEMT": "II"},
    {"waterway": "river", "name": "Rów Melioracyjny", "CEMT": "II"},  # excluded name beats evidence
    {"waterway": "river", "boat": "no", "CEMT": "II"},
    {"waterway": "river", "boat": "private", "name": "Narew"},
    {"waterway": "river"},
    {"waterway": "river", "name": "Odra"},
    {"waterway": "river", "wikidata": "Q999"},
])
def test_not_navigable(tags, allow):
    assert not is_navigable_way(tags, allow)


@pytest.mark.parametrize("tags", [
    {"waterway": "fairway"},
    {"waterway": "tidal_channel"},
    {"waterway": "canal", "CEMT": "Va"},
    {"waterway": "river", "cemt": "I"},
    {"waterway": "river", "ship": "yes"},
    {"waterway": "river", "boat": "permissive"},
    {"waterway": "river", "motorboat": "designated"},
    {"waterway": "river", "boat": "no", "motorboat": "yes"},  # boat=no only for rowing boats
    {"waterway": "river", "boat": "no", "ship": "yes"},
    {"waterway": "canal", "seamark:type": "fairway"},
    {"waterway": "canal", "seamark:type": "recommended_track"},
    {"waterway": "canal", "seamark:type": "navigation_line"},
    {"waterway": "canal", "lock": "yes"},
    {"waterway": "river", "wikidata": "Q123"},
    {"waterway": "river", "name": "Narew"},
    {"waterway": "river", "name:pl": "Narew"},
])
def test_navigable(tags, allow):
    assert is_navigable_way(tags, allow)


@pytest.mark.parametrize("tags,expected", [
    ({"waterway": "river"}, True),
    ({"waterway": "canal", "name": "Kanał"}, True),
    ({"waterway": "stream"}, False),
    ({"waterway": "river", "tunnel": "culvert"}, False),
    ({"waterway": "river", "intermittent": "yes"}, False),
    ({"waterway": "canal", "boat": "no"}, False),
    ({"waterway": "river", "name": "Rów melioracyjny"}, False),
])
def test_connector_candidate(tags, expected, allow):
    assert is_connector_candidate(tags, allow) is expected


@pytest.mark.parametrize("tags,expected", [
    ({"natural": "water"}, True),  # water=* defaults to lake
    ({"natural": "water", "water": "reservoir"}, True),
    ({"natural": "water", "water": "river"}, True),
    ({"natural": "water", "water": "pond"}, False),
    ({"natural": "water", "water": "lake", "intermittent": "yes"}, False),
    ({"landuse": "reservoir"}, True),
    ({"waterway": "dock"}, True),
    ({"waterway": "riverbank"}, True),
    ({"natural": "wood"}, False),
    ({}, False),
])
def test_candidate_lake(tags, expected):
    assert is_candidate_lake(tags) is expected


@pytest.mark.parametrize("tags,expected", [
    ({"name": "Śniardwy"}, True),  # lakes list
    ({"name:de": "narew"}, True),  # waterway names count too
    ({"wikidata": "Q123"}, True),
    ({"boat": "yes"}, True),
    ({"motorboat": "official"}, True),
    ({"name": "Staw", "boat": "no"}, False),
    ({}, False),
])
def test_lake_allowlisted(tags, expected, allow):
    assert lake_allowlisted(tags, allow) is expected


@pytest.mark.parametrize("ww,kind", [("canal", "canal"), ("fairway", "fairway"), ("tidal_channel", "fairway"),
                                     ("river", "river"), (None, "river")])
def test_kind_of(ww, kind):
    assert kind_of({"waterway": ww} if ww else {}) == kind


def test_exclude_patterns(tmp_path):
    (tmp_path / "x.yaml").write_text("waterways: [Spree]\nexclude_patterns: ['^Wehrarm', 'Altarm']\n", encoding="utf-8")
    allow = Allowlist.load(tmp_path)
    assert allow.excluded("Wehrarm Fürstenwalde")
    assert allow.excluded("Spree-Altarm")
    assert not allow.excluded("Spree")
    assert not allow.excluded(None)
    assert not is_navigable_way({"waterway": "river", "name": "Wehrarm Fürstenwalde", "CEMT": "IV"}, allow)
    assert not is_connector_candidate({"waterway": "canal", "name": "Altarm"}, allow)
    assert is_navigable_way({"waterway": "river", "name": "Spree"}, allow)


def test_channel_areas():
    from interway_pipeline.classify import is_channel_area
    assert is_channel_area({"natural": "water", "water": "canal"})
    assert is_channel_area({"natural": "water", "water": "lock"})
    assert is_channel_area({"waterway": "riverbank"})
    assert not is_channel_area({"natural": "water", "water": "lake"})
    assert not is_channel_area({"natural": "water"})
