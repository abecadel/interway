# Interway

A web chartplotter with route planning for **inland waterways** (and later the coast). It works like
Google Maps for boats: pick A (your GPS position, a map click or a search result) and B, and get a
navigable route over rivers, canals and lakes, with distance, ETA, locks and vessel limits.

![Zalew Zegrzyński → Giżycko](docs/screenshot-zegrze-mazury.png)

*Not for navigation.* Use it alongside official charts and notices to skippers.

## How it works

- **Data:** OpenStreetMap only (rivers, canals, lakes, locks, bridges, marinas). Basemap from OpenFreeMap,
  seamarks from OpenSeaMap, search from Photon. No API keys.
- **Pipeline** (`pipeline/`, Python): OSM extract → navigable waterway graph → static binary files
  (`graph.bin`, `geom.bin`, `manifest.json`, `pois.json`; spec in [docs/graph-format.md](docs/graph-format.md)).
  - navigability from OSM tags (`CEMT`, `boat`, `ship`, `motorboat`, fairways, locks) plus per-country
    allowlists in [`data/navigable/`](data/navigable/README.md)
  - lakes and reservoirs (no centre lines in OSM) become routable through a triangulated navigation mesh;
    touching lakes are merged, so chains like the Great Masurian Lakes connect
  - weirs/dams cut waterways, bridge clearances limit air draft, river direction gives up/downstream speed
  - short unverified channels between lakes are added as connectors (flagged)
- **App** (`app/`, React + TypeScript + MapLibre): routing runs **in the browser** (Web Worker, A\*) on the
  downloaded graph, so it can work offline. Vessel profile (speed, draft, air draft, beam, length, lock
  penalty), route summary and legs, GPX export, shareable URLs (`?from=lon,lat&to=lon,lat`).

The full plan and roadmap are in [docs/PLAN.md](docs/PLAN.md).

## Running

```bash
cd app
npm install
npm run dev            # http://localhost:5173  (uses the data in app/public/data)
npm test               # unit tests
```

The repository ships the graph for Poland, Germany, the Netherlands, Belgium, Switzerland, France, the UK's
rivers and canals, Austria, Czechia, Slovakia and the Danube countries (Hungary, Croatia, Serbia, Romania, Bulgaria), joined
by a sea network from the Atlantic to the Black Sea: enough for routes like Zalew Zegrzyński → Mazury,
Wrocław → Amsterdam, the Baltic → Mediterranean "Le Cut", the Grand Union Canal, Vienna → the Black Sea or
London → Crete.
Try `http://localhost:5173/?from=17.035,51.115&to=4.90,52.38`.

## Deployment

`.github/workflows/pages.yml` builds the app and deploys it to GitHub Pages on every push to `main`
(`https://<owner>.github.io/<repo>/`). One-time setup: repository **Settings → Pages → Source: GitHub Actions**.
The build sets `VITE_BASE=/<repo>/` so the app, its data and the service worker live under that path.

## Building waterway data

```bash
cd pipeline
pip install -e '.[dev]'
# Country/region extracts from https://download.geofabrik.de or https://download.openstreetmap.fr.
# Where neither is reachable, cut a bounding box out of the streamed Europe file (needs osmium-tool):
#   tools/stream-extract.sh https://ftp5.gwdg.de/pub/misc/openstreetmap/download.geofabrik.de/europe-latest.osm.pbf \
#     13.4,41.2,29.9,48.7 danube.osm.pbf && interway-filter danube.osm.pbf -o filtered/
python -m interway_pipeline.cli poland.osm.pbf germany.osm.pbf netherlands.osm.pbf \
    --region "PL-DE-NL" -o ../app/public/data --cache cache/
pytest -q

# check the canonical routes in data/test-routes.yaml against the result
cd ../app && INTERWAY_DATA=public/data npm run test:routes
```

`qa-components.json` in the output lists the disconnected parts of the network. Fix gaps by adding
names to `data/navigable/*.yaml` or connectors to `data/patches/*.geojson` (LineStrings whose ends snap to
the network).

## Status

- [x] Phase 0: app scaffold, map, GPS, A/B picking, search
- [x] Phase 1: pipeline v1, lake mesh, Zegrze → Mazury routes in the browser
- [ ] Phase 2: Germany + Netherlands + rest of Europe (Wrocław → Amsterdam), tiled geometry
- [ ] Phase 3: lock/bridge details on the map, offline search
- [x] Offline (PWA): app, waterway data and viewed map tiles cached by a service worker
- [ ] Phase 4: navigation mode
- [x] Phase 5: sea routing (coastal mesh, EMODnet depth)

## License and attribution

Map data © OpenStreetMap contributors (ODbL). Seamarks © OpenSeaMap contributors.
