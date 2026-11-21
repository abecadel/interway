# Navigability allowlists

OSM rarely tags whether a river is navigable. The pipeline includes a waterway when it has explicit tags
(`CEMT`, `ship/boat/motorboat=yes`, `waterway=fairway`, `lock=yes`, seamark fairway) **or** its name /
wikidata id is listed in one of these files.

```yaml
waterways: [Narew, Kanał Żerański]   # rivers/canals by name (any of name, name:pl, name:de, name:en ...)
lakes: [Śniardwy]                    # lakes/reservoirs that must be routable even without a navigable way touching them
wikidata: [Q209826]                  # exact wikidata ids, for ambiguous names
exclude: [Struga]                    # names never to include
exclude_patterns: ['^Wehrarm']       # regular expressions (case-insensitive) for names never to include
ways: [176725219]                    # OSM way ids, for reaches whose name is too common to list (Norway's "Straumen")
```

A river navigable only in part is listed with the box (west, south, east, north) of its navigable reach;
its ways count only where they have a node inside the box, so the name adds no shortcuts upstream:

```yaml
waterways:
  - {name: Sarthe, bbox: [-0.70, 47.45, 0.21, 48.02]}   # Angers (the Maine) to Le Mans
```

Names match with or without a leading French article (`L'Yonne`, `La Sarthe` match `Yonne`, `Sarthe`), and
in any file: the files are merged into one list.

Sources for entries: national lists of inland waterways (PL: Rozporządzenie RM w sprawie śródlądowych dróg
wodnych; DE: Bundeswasserstraßen list; NL: Rijkswaterstaat vaarwegen), plus popular recreational routes.

Regions are built separately (see `interway-merge`): the files directly in this directory are Europe's,
those in `north-america/` are read by the North American build (`--allowlist data/navigable/north-america`).
Keeping them apart means an edit in one region does not re-read the other region's extracts.
