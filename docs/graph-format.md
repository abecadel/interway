# Interway graph format, version 1

The pipeline (`pipeline/`, Python) writes these files. The app (`app/src/graph/format.ts`) reads them.
All integers and floats are **little-endian**. Every array starts at a 4-byte-aligned offset.
Coordinates are stored as `int32` in units of 1e-7 degree (≈1 cm).

## `graph.bin` – routing topology

| Field | Type | Count | Notes |
|---|---|---|---|
| magic | `u8[4]` | 4 | ASCII `IWG1` |
| version | `u32` | 1 | `1` |
| nodeCount (N) | `u32` | 1 | |
| edgeCount (M) | `u32` | 1 | directed edges |
| attrCount (A) | `u32` | 1 | rows in attribute table |
| nodeLat | `i32` | N | 1e-7° |
| nodeLon | `i32` | N | 1e-7° |
| edgeOffsets | `u32` | N+1 | CSR: edges of node `i` are `edgeOffsets[i] .. edgeOffsets[i+1]-1` |
| edgeTarget | `u32` | M | target node |
| edgeLength | `f32` | M | metres |
| edgeGeom | `u32` | M | geometry id in `geom.bin` |
| edgeAttr | `u16` | M | row in attribute table (0 = no restrictions) |
| edgeFlags | `u16` | M | see below; array is padded to 4 bytes |
| attrTable | `f32` | A×4 | per row: maxDraft, maxHeight (air draft clearance), maxWidth, maxLength in metres; `0` = unknown/unlimited |

### Edge flags

| Bit | Name | Meaning |
|---|---|---|
| 0 | `LOCK` | edge passes a lock |
| 1 | `LAKE` | crossing of lake/reservoir (synthetic edge) |
| 2 | `DOWNSTREAM` | travelling with the river current |
| 3 | `UPSTREAM` | travelling against the river current |
| 4 | `SEA` | open/coastal water |
| 5 | `GEOM_REVERSED` | edge goes from the geometry's last point to its first |
| 6 | `CANAL` | canal (no current) |
| 7 | `PATCH` | manual connector from `data/patches` |
| 8 | `NO_DEPTH` | open sea with no charted depth along it (outside EMODnet's European coverage); unset sea edges without a draft limit are charted deeper than 30 m |

Every undirected waterway segment is normally stored as two directed edges sharing one geometry id;
a one-way segment has only one.

## `geom.bin` – edge geometry (used for snapping and drawing)

| Field | Type | Count | Notes |
|---|---|---|---|
| magic | `u8[4]` | 4 | ASCII `IWS1` |
| version | `u32` | 1 | `1` |
| geomCount (G) | `u32` | 1 | |
| pointCount (P) | `u32` | 1 | |
| geomFrom | `u32` | G | graph node at the first point |
| geomTo | `u32` | G | graph node at the last point |
| geomOffsets | `u32` | G+1 | points of geometry `g` are `geomOffsets[g] .. geomOffsets[g+1]-1` |
| lat | `i32` | P | 1e-7° |
| lon | `i32` | P | 1e-7° |
| nameIndex | `u32` | G | index into `names` list in `manifest.json` (`0` = unnamed) |

Version 2 will split `geom.bin` into z6 tiles loaded lazily; version 1 is one file.

## `manifest.json`

```json
{
  "version": 1,
  "osmTimestamp": "2026-11-01T00:00:00Z",
  "region": "europe",
  "files": { "graph": "graph.bin", "geom": "geom.bin", "pois": "pois.json" },
  "names": ["", "Odra", "Kanał Gliwicki"],
  "attribution": "© OpenStreetMap contributors, ODbL"
}
```

## `pois.json`

```json
[{ "type": "lock", "name": "Śluza Brzeg Dolny", "lat": 51.27, "lon": 16.71 }]
```

`type` is currently `lock` or `marina` (`bridge`, `fuel`, `port` are planned).
