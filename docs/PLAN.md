# Interway – web chartplotter with inland-waterway routing ("Google Maps for boats")

## Context
New project (repo `abecadel/interway` is empty: only README). Goal: a web chartplotter where a skipper picks
point A (GPS position or map click / search) and point B, and gets a navigable route over rivers, canals,
lakes and, later, coastal sea. Examples to work: **Zalew Zegrzyński → Mazury** and **Wrocław → Amsterdam**
(Odra → Odra–Havel → Berlin → Elbe–Havel/Mittellandkanal → Twentekanaal/IJssel or Rhine → Amsterdam).

Decisions made:
- **Routing runs in the browser, offline** (Web Worker on a precomputed graph). No routing backend; app is static hosting.
- **Scope: whole Europe** from the start.
- **Frontend: React + TypeScript + Vite.**
- Only free/open data (OpenStreetMap, OpenSeaMap, OpenFreeMap, Photon). No dependency on any third-party
  waterways website/API.

## Architecture

```
interway/
  pipeline/   Python: OSM → navigable waterway graph → static binary files
  app/        React+TS PWA: map, routing worker, navigation UI
  data/       config: navigability allowlists, manual graph patches, canonical test routes
  docs/       graph-format.md (binary spec shared by pipeline + app)
```

### 1. Data pipeline (`pipeline/`, Python 3.12, pyosmium, shapely, numpy)
1. **Download** Geofabrik per-country PBFs (Europe in one file is ~30 GB; per-country keeps CI disk small).
2. **Filter** with `osmium tags-filter`: `waterway=river,canal,fairway,lock,lock_gate,weir,dam`,
   `natural=water` (lake/reservoir), `leisure=marina`, `bridge=*` ways crossing water, `seamark:*`,
   waterway route relations. Merge filtered extracts (small, ~1–2 GB → much less).
3. **Classify navigability** of each way:
   include if `CEMT=*`, `ship=yes`, `boat=yes|permissive`, `motorboat=yes`, seamark fairway tags,
   member of a waterway route relation, or in curated allowlist `data/navigable/<country>.yaml`;
   exclude `boat=no`, `waterway=stream/ditch/drain`, weirs/dams without lock.
4. **Build topology**: split ways at shared nodes, nodes = junctions/locks/endpoints.
5. **Lakes & reservoirs** (critical for Mazury, Zalew Zegrzyński, IJsselmeer): for each water polygon touched
   by ≥1 navigable way (or allowlisted), connect all entry points + marinas with a visibility graph inside
   the polygon (shapely, buffered inward ~30 m), giving routable lake crossings.
6. **Attributes per edge**: length, CEMT class, min `maxdraft`, min bridge clearance (`maxheight`,
   `seamark:bridge:clearance_height` from bridges intersecting the edge), `maxwidth/maxlength`, lock flag +
   lock name/dimensions, flow direction (OSM river way direction → upstream/downstream speed), `maxspeed`.
7. **Manual patches** `data/patches/*.geojson`: connectors for known OSM gaps (applied after build).
8. **Contract** degree-2 nodes (geometry kept separately), check **connected components**, emit QA report
   (GeoJSON of small components / dead ends near big ones) for fixing gaps.
9. **Export** (spec in `docs/graph-format.md`):
   - `graph.bin` – CSR graph: node coords (int32 1e-6°), edge targets, length, cost flags, attr index. Estimate
     ~300k nodes / ~800k directed edges for Europe → ~5 MB gzip, loaded once.
   - `geom/{z6 tile}.bin` – simplified (Douglas–Peucker ~5 m) edge polylines chunked by tile, lazy-loaded for
     snapping and route drawing.
   - `pois.json(.gz)` – locks, bridges w/ clearance, marinas, ports, fuel; also feeds offline search.
   - `manifest.json` – version, OSM date, checksums, ODbL attribution.
10. Pipeline runs locally / in a GitHub Action (monthly); outputs uploaded to static storage (GitHub Releases or
    Cloudflare R2), app fetches by manifest version.

### 2. Web app (`app/`, Vite + React + TS)
- **Map**: MapLibre GL JS; basemap OpenFreeMap vector tiles (free, no key); OpenSeaMap seamark raster overlay
  (`tiles.openseamap.org/seamark/{z}/{x}/{y}.png`); own layers: waterway graph (debug), route, locks/bridges.
- **Routing worker** (`app/src/routing/`): decode `graph.bin` (typed arrays), snap A/B to nearest edge via
  Flatbush index over loaded geometry tiles, **bidirectional A\*** (haversine heuristic), cost = travel time
  (boat speed ± current) + lock penalty (default 20 min) + optional "avoid locks". Edges filtered by vessel
  profile (draft, air draft, beam, length). Returns path, geometry, events (locks, bridges, junctions, lakes).
  Same router code runs in Node for tests.
- **UI**: A/B inputs (my position via Geolocation API, map click, search), vessel profile (saved in
  localStorage), route summary (distance km/NM, ETA, # locks, min clearance/depth), itinerary list,
  GPX export/import.
- **Search**: Photon (komoot) online; offline fallback = local index of marinas, locks, towns from `pois.json`.
- **Navigation mode**: follow-me, COG/SOG, next event ("Lock Brandenburg in 3.2 km"), cross-track error,
  automatic reroute when off-route, Screen Wake Lock API.
- **PWA / offline**: service worker (Workbox) caches app shell, graph, geometry tiles, POIs; "download
  route corridor" caches basemap/seamark tiles along route (later: regional PMTiles extracts).
- Disclaimer: "Not for navigation – supplementary aid", ODbL/OpenSeaMap attribution.

## Phases
0. **Scaffold** – monorepo, Vite React app with MapLibre + OpenFreeMap + OpenSeaMap, GPS position, click to set
   A/B. CI: lint, typecheck, tests.
1. **Pipeline v1 on Poland** – filter, classify, topology, lakes, export; debug layer of graph & components;
   route Zegrze → Giżycko in the browser.
2. **Europe** – loop all countries, allowlists + patches until canonical routes pass:
   Wrocław–Amsterdam, Zegrze–Giżycko, Berlin–Szczecin, Paris–Lyon, Vienna–Budapest, Gdańsk–Elbląg.
3. **Vessel profile & route details** – constraints, locks/bridges, itinerary, GPX, search.
4. **Navigation mode + PWA offline**.
5. **Coastal sea routing** – sea mesh from OSM land polygons (osmdata.openstreetmap.de) with coastal safety
   buffer + seamark fairways, joined at river mouths/ports (e.g. Szczecin → Baltic, IJmuiden).
6. **Later** – live water levels (PEGELONLINE DE, IMGW PL open data), lock hours, Notices to Skippers, AIS,
   depth from EMODnet bathymetry.

## Verification
- `pytest` on pipeline units with a small fixture PBF (river + lock + lake + bridge).
- `vitest` for graph decoding and A* on synthetic graphs.
- **Canonical route suite** (Node, same router, real Europe graph): each route in `data/test-routes.yaml` must be
  found, distance within ±10 % of expected, and pass through expected waypoints (e.g. Berlin for Wrocław–Amsterdam).
- Playwright e2e: open app, set A/B by map click, assert route line + summary appear; offline test with network
  disabled after first load.
- Manual: QA GeoJSON reviewed on the debug map after each pipeline run.

## Key risks
- OSM gaps/connectivity (rivers mapped only as area, missing lock links) → QA report + manual patches.
- Navigability not tagged consistently → per-country allowlists (based on official national waterway lists).
- Offline basemap for all of Europe is huge → cache along route corridor first.
