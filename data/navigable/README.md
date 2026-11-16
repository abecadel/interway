# Navigability allowlists

OSM rarely tags whether a river is navigable. The pipeline includes a waterway when it has explicit tags
(`CEMT`, `ship/boat/motorboat=yes`, `waterway=fairway`, `lock=yes`, seamark fairway) **or** its name /
wikidata id is listed in one of these files.

```yaml
waterways: [Narew, Kanał Żerański]   # rivers/canals by name (any of name, name:pl, name:de, name:en ...)
lakes: [Śniardwy]                    # lakes/reservoirs that must be routable even without a navigable way touching them
wikidata: [Q209826]                  # exact wikidata ids, for ambiguous names
exclude: [Struga]                    # names never to include
```

Sources for entries: national lists of inland waterways (PL: Rozporządzenie RM w sprawie śródlądowych dróg
wodnych; DE: Bundeswasserstraßen list; NL: Rijkswaterstaat vaarwegen), plus popular recreational routes.
