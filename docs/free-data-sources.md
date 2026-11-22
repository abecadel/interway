# Free and open data sources for Interway

Research date: 22 Nov 2026. This report builds on `docs/charts-research.md` (21 Nov 2026), which already covers
the European sources:

- EuRIS NtS, fairway objects and API terms
- DoRIS
- PEGELONLINE and Hub'Eau as sources
- RWS Waterwebservices
- European IENCs
- EMODnet DTM and vessel density
- FES2022, TPXO, SHOM and UKHO tides
- ECMWF, DWD and Open-Meteo
- Copernicus Marine
- AIS options

Those are not repeated here except where I found something new: a CORS result, a new endpoint, or a licence
correction. The focus is North America, which has the biggest gaps: sea depth, lock data and notices.

**How each claim was verified**

- **[probe]**: I called the endpoint from this session with
  `Origin: https://abecadel.github.io` and saw the response, including the `Access-Control-Allow-Origin` header.
- **[page]**: I read the provider's own page, catalogue record or licence PDF.
- **[unverified]**: secondary sources only, or the provider site was down. Say so before you rely on it.

**What "usable" means** (the brief's two tests)

- **Static**: the licence allows redistribution of the source or a derived product in the public GitHub Pages
  pack.
- **Live**: the browser can call it directly (CORS allowed, no key or a free key that can be public).
- **Action cache**: no CORS, but the licence allows a scheduled GitHub Action to fetch it and publish JSON next to
  the graph. That keeps Interway serverless.

**Pipeline context** (from the repo)

- The pipeline depends on `osmium`, `shapely`, `numpy`, `pyshp` and `tifffile`, with no GDAL. Its tests need
  100 % coverage.
- `depth.py` samples EMODnet GeoTIFF tiles fetched by WCS through a `tile_loader`, and gives each sea-mesh edge a
  draft limit from the shallowest point along it. Its `COVERAGE` box stops it at European waters.
- The data pack is about 74 MB.
- The app already calls Open-Meteo from the browser (`app/src/ui/conditions.ts`).

---

## 1. Bathymetry and depth

### 1.1 GEBCO_2026 Grid: global, public domain [page]

- **URL:** https://www.gebco.net/data-products/gridded-bathymetry-data
- **What it provides:** global elevation (m) on a 15 arc-second grid (about 460 m at the equator, about 330 m at
  45°N), plus a Type Identifier (TID) grid that says what each cell's source is. A new grid comes out every year.
  An experimental multi-resolution grid exists where finer source data does.
- **Coverage:** worldwide: every North American sea leg, the open North Atlantic, Greenland and Iceland.
- **Format and access:**
  - global netCDF (4 GB zipped, 7 GB unzipped)
  - 8 GeoTIFF tiles of 90°×90° (4 GB zipped)
  - Esri ASCII
  - a download app for a user-defined area
  - OPeNDAP through CEDA
- **Licence:** "The GEBCO Grid is placed in the public domain and may be used free of charge." Attribution is
  requested ("GEBCO Bathymetric Compilation Group 2026 … doi:10.5285/4f68d5c7-45eb-f999-e063-7086abc036fa").
  The earlier report notes that the terms say it "must not be used for navigation".
- **Static or live:** static. A derived per-edge draft limit can be redistributed.
- **Size and effort:** **S.**
  - Download the NA tiles (or a bbox from the download app) once, and cache them.
  - Add a `gebco_tile_loader` that `DepthGrid` falls back to outside EMODnet's `COVERAGE`. The tiles are plain
    GeoTIFFs on a regular lat/lon grid, so `tifffile` reads them with no GDAL.
- **How it plugs in:**
  - `depth.py`: add a second loader with the same interface (elevation, negative below sea level).
  - Keep EMODnet first in Europe.
  - The brief says "charted depth from GEBCO (~450 m grid)" instead of "depth unknown".
- **Caveats:**
  - It is coarse, and very coarse near shore. Its shallow-water datum is mean sea level, not chart datum.
  - Treat it like the existing EMODnet margin (minus 0.5 m), or larger.
  - Use the TID grid to flag cells that are interpolated rather than surveyed.

### 1.2 NOAA ENC (S-57): US coast, Great Lakes, ICW; CC0 / public domain [page][probe]

- **URL:** https://www.charts.noaa.gov/ENCs/ENCs.shtml . Product catalogue (10 MB XML, refreshed daily):
  https://www.charts.noaa.gov/ENCs/ENCProdCat.xml
- **What it provides:** vector charts. The S-57 object classes that matter to Interway are standard S-57:
  - `DEPARE`: depth areas, with `DRVAL1`/`DRVAL2`
  - `DRGARE`: dredged channels, with maintained depth
  - `SOUNDG`: soundings
  - `DEPCNT`: depth contours
  - `OBSTRN`, `WRECKS`, `UWTROC`: hazards
  - `BRIDGE`: `VERCLR`, `VERCCL` and `VERCOP` (vertical clearance, closed and open)
  - `GATCON` and `LOKBSN`: locks
  - `SMCFAC` and `HRBFAC`: small-craft facilities and harbours
  - `ACHARE`: anchorages
  - `RESARE`: restricted areas
  - Covers US coastal waters, the Great Lakes, the ICW and harbour approaches.
  - I did not open a cell in this session (no GDAL here), so the object list comes from the S-57 standard, not
    from a cell.
- **Format and access:**
  - per-cell ZIPs
  - `All_ENCs.zip`: 772 MB on the page; 807 MB by HEAD request, last modified 21 Nov 2026 [probe]
  - packages by Coast Guard district (42–199 MB), by state and by region
  - incremental "One week" (23 MB) and "Ten days" (30 MB) bundles
  - NOAA updates ENCs weekly for Notices to Mariners.
- **Licence:**
  - The data.gov record gives `https://creativecommons.org/publicdomain/zero/1.0/` [page].
  - NOS: "information on government servers are in the public domain"; it requests attribution
    ("Provided by NOAA Office of Coast Survey").
  - I did not read the ENC download "User's Agreement" page itself [unverified]. Treat it as a click-through
    disclaimer (not for navigation, no warranty).
- **Static or live:** static, as derived per-edge limits and vector layers.
- **Size and effort:** **M–L.**
  - Needs GDAL/OGR (the S57 driver, through `pyogrio` or `osgeo`) as an optional pipeline dependency.
  - Read `DEPARE`, `DRGARE` and `BRIDGE` for the NA bbox, using the largest-scale (most detailed) cell where cells
    overlap.
  - Intersect them with sea-mesh and coastal edges.
- **How it plugs in:**
  - **Sea legs:** per edge, the minimum `DRVAL1` over the `DEPARE` polygons it crosses. Where an edge runs inside
    a `DRGARE`, use the dredged depth. This fixes the "coarse grid crosses banks that boats pass in dredged
    channels" problem from llms.txt, which EMODnet and GEBCO cannot fix.
  - **Bridges:** fill missing OSM `maxheight` / `seamark:bridge:clearance_height` from `VERCLR` by spatial
    match. Many ICW bridges lack a clearance in OSM.
  - **Harbour approaches:** the first ~1.5 km off shore, which today has no depth.
  - **Optional basemap:** NOAA's Chart Display Service WMTS
    (https://gis.charttools.noaa.gov/arcgis/rest/services/MarineChart_Services/NOAACharts/MapServer/WMTS) returns
    `access-control-allow-origin` echoing our origin [probe]. MBTiles are at
    https://distribution.charts.noaa.gov/ncds/ (sizes not checked).
- **Caveats:**
  - ENC depths are relative to chart datum (MLLW, or LWD on the Great Lakes), not to the current water level.
  - Overlapping cells at different scales need a "best scale wins" rule.
  - NOAA is rescheming ENCs into a rectangular layout, so cell names change.

### 1.3 NOAA BlueTopo / National Bathymetric Source: US, best available [page][probe]

- **URL:** https://nauticalcharts.noaa.gov/data/bluetopo.html . Bucket:
  `s3://noaa-ocs-nationalbathymetry-pds/BlueTopo/` (`https://noaa-ocs-nationalbathymetry-pds.s3.amazonaws.com`).
- **What it provides:**
  - multi-band GeoTIFFs: elevation, uncertainty, and contributor (with a raster attribute table of survey quality,
    feature least depth and coverage)
  - tiled to the ENC scheme
  - "best available" US bathymetry from NOAA and USACE surveys and topo-bathy lidar, with gaps filled from GMRT
  - updated weekly to monthly
- **Coverage:** US navigationally significant waters. The tile index is
  `BlueTopo/_BlueTopo_Tile_Scheme/BlueTopo_Tile_Scheme_20261120_151125.gpkg` [probe]. I counted **8,690 tile
  folders** in this session. Sample tiles are 89–182 MB each, so the full set is on the order of a terabyte.
- **Licence:** AWS registry entry: "NOAA data disseminated through NODD are open to the public and can be used as
  desired … NOAA requests attribution … not permissible to state or imply endorsement … If you modify NOAA data,
  you may not state or imply that it is original" [page]. The registry also says BlueTopo is "not for navigation
  due to the inclusion of additional non-navigation data and non-navigation vertical datums".
- **Static or live:**
  - Static: derived values only.
  - The S3 bucket sends `Access-Control-Allow-Origin: *` [probe], so a browser could range-read COG tiles. I did
    not check whether the files are cloud-optimised (internal overviews) [unverified]. Not a good fit for the app
    anyway.
- **Size and effort:** **L.** Sample only the tiles that the NA sea mesh crosses, with range reads, or resample
  to about 100 m once. Run it on a CI runner, not in the repo.
- **How it plugs in:** a third `DepthGrid` loader, preferred over GEBCO inside US waters.
- **Caveat:** its vertical datum varies by tile and is not chart datum. Use ENC `DEPARE` for draft decisions, and
  BlueTopo only for edges with no ENC coverage.

### 1.4 NCEI Coastal Relief Model and CUDEM: US coast [page]

- **URL:** https://www.ncei.noaa.gov/products/coastal-relief-model
- **What it provides:**
  - CRM volumes 1–5 and 9–10 (2023), 7–8 (2025) and 6 (2003), at 1 or 3 arc-second, with Southern Alaska at 24
    arc-second
  - built from NCEI CUDEMs
  - EGM2008 or MSL vertical datum
- **Access:** THREDDS catalogues and a Grid Extract tool. NCEI notes temporary outages during its cloud
  migration.
- **Licence:** "cannot be used for navigation". Products derived mainly from NCEI data "are not subject to U.S.
  copyright protection"; cite NCEI.
- **Static or live:** static, derived values.
- **Effort:** **M.** It is a smaller and simpler alternative to BlueTopo: one netCDF per volume, regular grids.
- **Verdict:** a good middle step between GEBCO and ENC for US coastal legs, but it does not cover Canada or
  Alaska's Inside Passage in detail.

### 1.5 CHS NONNA-10 / NONNA-100: Canada [page][probe]

- **URL:** https://open.canada.ca/data/en/dataset/d3881c4c-650d-4070-bf9b-1e00aabf0a1d . Portal:
  https://data.chs-shc.ca/
- **What it provides:**
  - gridded bathymetry at about 10 m and about 100 m
  - cells of 0.1° (NONNA-10) and 1° (NONNA-100) south of 68°N
  - WGS84 horizontally; **chart datum** vertically
  - Formats: GeoTIFF, XYZ, CSAR and BAG.
  - Services:
    - WMS
    - WMTS
    - WCS at `https://nonna-geoserver.data.chs-shc.ca/geoserver/wcs`, which returned
      `access-control-allow-origin: *` [probe]
    - The geoserver answered "no healthy upstream" on a second call, so it is flaky.
  - Updated 1 Apr 2026.
- **Coverage:** Canadian waters: Atlantic Canada and the St. Lawrence estuary, Great Lakes (Canadian side) and BC
  coast, which includes the Inside Passage approaches.
- **Licence:** the catalogue says "Open Government Licence – Canada", but the dataset is governed by the **CHS
  NONNA Licence** (PDF read [page]):
  - "The Data shall not be used for navigation."
  - Clause 2: CHS copyright "shall not be sold, licensed, leased, assigned or given to a third party".
  - Clause 7: a derivative product must carry a prominent notice. The text begins "This product was made by
    [name] and contains intellectual property of the Canadian Hydrographic Service (CHS) … does not meet the
    requirements of the Navigation Safety Regulations, 2020 …".
  - Clauses 12 and 14: the licence can be ended by public notice, and copies must then be destroyed within
    15 days.
- **Static or live:**
  - **Derived** per-edge draft limits in the static pack look allowed if the notice is shown.
  - **Do not redistribute the raw grid.**
  - Live WCS from the browser is technically possible but pointless.
- **Effort:** **S–M.** Same WCS pattern as EMODnet (`depth.py` already speaks WCS 2.0.1). Use NONNA-100 for sea
  legs and NONNA-10 near harbours.
- **Caveat:** the termination clause means a derived layer may one day have to be withdrawn. Keep it separable
  (a per-source depth field in the build), and show the CHS notice in the app's attributions and brief.

### 1.6 USACE National Channel Framework (NCF) and eHydro: US federal channels [probe]

- **NCF:**
  - URL: https://services7.arcgis.com/n1YM8pTrFmm7L4hs/arcgis/rest/services/National_Channel_Framework/FeatureServer
  - Layers: ChannelLine, ChannelArea (2,733), ChannelReach and ChannelQuarter (25,264).
  - ChannelQuarter carries `depthauthorized` and `depthmaintained`, in feet. For example, Pensacola entrance:
    35/35.
  - The service sends `Access-Control-Allow-Origin: *`.
- **eHydro survey index:**
  - URL: https://services7.arcgis.com/n1YM8pTrFmm7L4hs/arcgis/rest/services/eHydro_Survey_Data/FeatureServer/0
  - 124,348 survey jobs; the newest surveyed 20 Nov 2026.
  - Each links a ZIP on `ehydroprod.blob.core.usgovcloudapi.net` with XYZ, a contour KMZ, a **shoal polygon
    KMZ**, SHP, GDB and a PDF plot sheet.
- **What they provide:** maintained depth of each federal channel, and recent condition surveys showing actual
  shoaling. This covers ICW reaches, harbour entrances and inlets: exactly where GEBCO and ENC go stale.
- **Licence:**
  - The ArcGIS copyright text is "USACE". This is a US federal work, so public domain under 17 USC 105.
  - I found no explicit licence statement on the services [unverified].
- **Static or live:** static, as per-edge maintained depth. The newest shoal polygons could be fetched live, since
  the service has CORS.
- **Effort:**
  - **S** for NCF: query once and join `depthmaintained` to coastal and ICW edges that run inside a ChannelQuarter
    polygon.
  - **M–L** for parsing eHydro surveys.
- **Caveat:**
  - Maintained depth is a target, not a guarantee.
  - Depths are in feet, relative to MLLW, or LWRP on rivers.

### 1.7 European inland fairway depths: new finds

- **Rijkswaterstaat FIS dataservice (CC0)**: geotypes `fairwaydepth` (1,333 lines) and `maximumdimensions`
  (602 lines, with `GeneralDepth`). See 2.7.
- PEGELONLINE `F`/`T` series and DoRIS are covered in the earlier report.

---

## 2. Inland waterway facts: locks, bridges, fairway class

### 2.1 USACE lock characteristics (NTAD "Waterway Locks"): public domain [page][probe]

- **URL:** https://services7.arcgis.com/n1YM8pTrFmm7L4hs/ArcGIS/rest/services/Locks/FeatureServer/0 . Catalogue:
  https://catalog.data.gov/dataset/waterway-locks-981b5 . Data dictionary: https://doi.org/10.21949/180Q-FC93
- **What it provides:** **234 lock chambers** built, owned or operated by USACE, in 26 states, including NY. Each
  record has:
  - name and river mile
  - lift
  - `LENGTH` / `CHMBUL` (usable length) and `WIDTH` / `CHMBUW` (usable width), in feet
  - upper and lower sill depths (`UPDPTHMS`, `LWDPTHMS`)
  - gate type, year opened and status
  - channel depths and widths above and below
  - operator and owner
  - For example, Bonneville: 675×86 ft, lift 65 ft.
- **Format and access:** ArcGIS REST, with GeoJSON and CSV downloads through the NGDA hub. The service sends
  `access-control-allow-origin: *`.
- **Licence:** "Public domain" (usa.gov public domain label 1.0); publisher USACE; last modified 11 Dec 2025.
- **Static or live:** static.
- **Effort:** **S.** One query (234 rows). Snap each chamber to the nearest graph lock node (within 1 km, same
  river name), and set chamber length, beam and sill depth where OSM lacks them. This gives the "Lock counts" in
  llms.txt real chamber limits on the Mississippi, Ohio, Tennessee, Columbia–Snake and Illinois systems.
- **Caveat:**
  - USACE locks only. It excludes NYS Canal locks, the Seaway, Parks Canada, Florida's Cross-Florida/Okeechobee
    structures (some are USACE, so check) and private locks.
  - Sill depth and usable dimensions are in feet.

### 2.2 USACE Lock Performance Monitoring System (LPMS) and Corps Locks: live queues and closures [unverified]

- **URL:** https://corpslocks.usace.army.mil/ . It returned **502 Bad Gateway** from this session.
- **What it provides:** per secondary sources:
  - a lock queue report for the past 24 h
  - a "Public Lock Unavailability Report" of scheduled and unscheduled closures
  - XML web services
- **Licence:** US federal, so presumably public domain.
- **Usable:** unknown. I could not confirm the live endpoints, CORS, or whether the service is still up.
- **Verdict:** do not plan on it. USCG LNM (3.1) carries the scheduled lock closures that matter to pleasure craft.

### 2.3 USACE Inland ENC (IENC): US rivers [page]

- **URL:** https://ienccloud.us/ . Catalogues: `ienccloud.us/ienc/products/catalog/IENCU37ProductsCatalog.xml`,
  with RSS feeds.
- **What it provides:**
  - Inland ENC 2.4 (S-57 based) for **7,260 miles** across 20 river systems: Ohio 0–981, Upper and Lower
    Mississippi, Missouri, Arkansas, Illinois, Tennessee, Cumberland and others.
  - Formats: S-57, SHP/GDB, KML and a buoy overlay, plus WMS and WFS.
  - Updated monthly with USCG LNMs.
  - The encoding guide covers bridges (with vertical clearance attributes), lock chambers and walls, sailing line,
    and depth areas where surveyed. I did not open a cell to confirm each attribute [unverified].
- **Licence:** no explicit licence on the page. It is a USACE federal work, so public domain. The page's
  disclaimer urges caution: features "may be significantly inaccurate".
- **Static or live:** static, derived.
- **Effort:** **M.** It reuses the S-57 reader built for NOAA ENC (1.2).
- **How it plugs in:**
  - Fill bridge clearance on US rivers. OSM coverage of `maxheight` on Mississippi and Ohio bridges is patchy.
  - Lock chamber geometry.
  - The sailing line as a better centre line than OSM on wide rivers.

### 2.4 FHWA National Bridge Inventory (NBI): US bridges over waterways [page, items unverified]

- **URL:** https://www.fhwa.dot.gov/bridge/nbi/ascii.cfm . Years 1992–2025, ASCII.
- **What it provides:** all US highway bridges. From the NBI Coding Guide (not re-read in this session):
  - Item 38: navigation control
  - Item 39: navigation vertical clearance
  - Item 40: navigation horizontal clearance
  - Item 116: minimum vertical clearance of a lift bridge
  - The page says the Coding Guide "is no longer maintained" and that the SNBI replaced its items in 2022.
- **Licence:** US federal data, so public domain. The page warns that "NBI data should not be used for route
  clearance purposes".
- **Effort:** **M.** Location is coarse (DMS lat/lon), and matching it to OSM bridges needs care.
- **Verdict:** a fallback after ENC/IENC `VERCLR`. It helps on small rivers and lakes that ENCs do not chart.

### 2.5 New York State Canal System (data.ny.gov) [probe]

- **Datasets:**
  - "Canal System Locks" (56 rows): https://data.ny.gov/resource/ta83-js48.json
  - "Canal System Lift Bridges": https://data.ny.gov/resource/pe3j-9bkg.json
  - "Canal System Guard Gates"
- **What it provides:** name, body of water, mile, lift (e.g. "11.1' ↓NB/↑SB"), lock phone number, address, and
  the attachment method (pipes and cables, lines). The lift-bridge rows have mile and phone, **but no clearance**.
- **Access:** Socrata SODA JSON with `Access-Control-Allow-Origin: *`; no key needed at low volume.
- **Licence:** no licence field on the dataset. data.ny.gov's general terms of use apply [unverified].
- **Effort:** **S.** Snap to graph lock nodes, and add the phone number and lift to lock cards and the brief.
- **Caveat:** no chamber dimensions in the dataset (the Erie locks are 328×45 ft; take that from the canal
  guide as a waterway-sheet fact).

### 2.6 Parks Canada canals and the St. Lawrence Seaway [page]

- **Parks Canada:**
  - The only open dataset I found is "Lockstation Gates" (OGL-Canada):
    https://services2.arcgis.com/wCOMu5IS7YdSyPNx/arcgis/rest/services/Lockstation_Gates_Portes_Ecluses_APCA_OpenOuvert/FeatureServer/0
  - It holds 92 gate lines with **only a name**: no dimensions and no hours.
  - Lock dimensions, bridge clearances and hours are on per-canal web pages: the Trent–Severn "Technical Data"
    and lockstation list, and the Rideau's 24 lockstations
    (https://parks.canada.ca/lhn-nhs/on/rideau/visit/navigation).
  - I did not check whether those pages carry a reuse licence [unverified].
  - Approach: hand-curate them into `app/src/data/waterways.json` sheets with sources and date checked, as for
    Europe. About 100 rows.
- **St. Lawrence Seaway** (https://greatlakes-seaway.com/en/pleasure-craft/):
  - Pleasure-craft tolls: CAD 25 per lock at St. Lambert, Côte Sainte-Catherine and Iroquois; CAD 50 for
    Beauharnois 3 and 4; CAD 200 for the eight Welland locks; USD 30 per US lock.
  - 2026 seasons: Welland 1 May–25 Oct; Montreal–Lake Ontario 15 May–7 Sep, with a late season to 18 Oct.
  - Reservation cut-offs, VHF 14, and small-boat docks at Port Weller and Port Colborne.
  - A lockage schedule tool at https://seaway-greatlakes.com/lockage-schedule/schedule
  - No API or data feed.
  - **Use as a waterway sheet**, not a data source. The page itself gives two different Welland late-season
    dates.

### 2.7 Rijkswaterstaat FIS dataservice: Netherlands, CC0 [probe][page]

- **URL:** `https://www.vaarweginformatie.nl/wfswms/dataservice/1.4/{geogeneration}/{geotype}?offset=0&count=N`.
  The current generation comes from `…/1.4/geogeneration` (5002, published 18 Nov 2026).
- **What it provides** (checked live; counts in brackets):
  - `lock` [1,016]: ISRS id, route km, number of chambers, reference levels, `OperatingTimesId`
  - `chamber` [431]: polygons; the dimensions should be among the fields, but the sample output was cut off
  - `bridge` [6,945]: `CanOpen`, `NumberOfOpenings`, reference level
  - `opening` [4,348]: `HeightClosed`, `ClearanceHeightClosed`, `Width`, type
  - `operatingtimes` [762]: structured periods and rules (start/end date, weekdays, holidays, from/to times),
    plus notes such as "from Beaufort 8 the bridge does not turn"
  - `berth` [8,538]
  - `fairwaydepth` [1,333]
  - `maximumdimensions` [602]
  - NWB fairway lines with CEMT classification (data.overheid.nl "nwp_classificering_vaarwegen", CC0)
- **Format:** paged JSON with WKT geometry, no key. The responses carry **no CORS header**, so it is not for
  browsers.
- **Licence:**
  - data.overheid.nl lists the FIS_VNDS layers as **CC0 1.0**: Lock, Maximumdimensions, Touristharbour,
    Trailerslipway and more [page].
  - The EuRIS-sourced "reguliere bedieningstijden" (regular operating times) and "kortstondige wijzigingen"
    (short-term changes) records say **"licentie onbekend"** (licence unknown).
  - The dataservice `operatingtimes` geotype has no licence statement of its own [unverified].
- **Static or live:** static for geometry and dimensions (CC0). Operating times: probably fine, since it is the
  same FIS store, but confirm with ndt@rws.nl before bulk redistribution.
- **Size and effort:** **M.** Thousands of features; about 10–20 MB raw, much less once reduced. Snap to graph
  nodes by ISRS code or geometry. Convert `operatingtimes` into OSM-style `opening_hours` strings, so the same
  "arrives after closing" check (shortlist item 3 in the earlier report) works.
- **Why it matters:** the Netherlands is the densest bridge network in Interway's area. This gives authoritative
  closed-bridge clearances and opening hours with no EuRIS token.

### 2.8 Germany: WSV WInD WFS [probe][page]

- **URL:** https://via.bund.de/wsv/wind/www/wfs/capabilities . It sends `Access-Control-Allow-Origin: *`.
- **What it provides:** the inventory of federal waterway structures; 166 feature types, including:
  - 311 ship locks (361 features)
  - 312 ship lifts
  - 313 boat locks (89)
  - 323 waiting and mooring places
  - 324 harbours of refuge
  - Bridge-related types.
  - Each record has the name, WSA office, waterway id and km, year built and operating status ("in Betrieb").
    **No chamber dimensions or clearances.**
  - Coordinates are in EPSG:25832.
- **Licence:** "Nutzungsbestimmungen für die Bereitstellung von Geodaten des Bundes" (GeoNutzV: free, including
  commercial use, with attribution) [page, geoportal-bw record].
- **Effort:** **S.** Use it to check OSM lock and boat-lock coverage and status, and to add waterway km to lock
  cards. Dimensions still come from OSM, IENC or ELWIS.

### 2.9 UK Canal & River Trust ArcGIS open data [probe][page]

- **URL:** https://data-canalrivertrust.opendata.arcgis.com/ . Feature services for locks, bridges, tunnels,
  winding holes, slipways, aqueducts, boat lifts, docks and wharves (CORS `*`).
- **What it provides:** locks and bridges have only `sap_description`, `sap_object_type`, `angle` and
  `waterway_name`. **No dimensions or clearances.**
- **Licence:** CRT's own licence (PDF read). Clause 3.1.4 excludes use "for or in connection with or for the
  direct or indirect benefit of any Commercial Purpose", and attribution is "© The Canal & River Trust copyright
  and database rights reserved [year]".
- **Verdict:** low value. Interway is non-commercial, so it would be allowed, but it adds little beyond OSM.
  Winding holes, the turning points for narrowboats, are the one useful layer.

### 2.10 France (VNF) and Austria [page]

- data.gouv.fr lists one VNF dataset, a procurement statement.
- I found no VNF open data for locks, hours or *avis à la batellerie*. VNF points to its NAVI app.
- France's NtS and structures are reachable only through **EuRIS** (covered in the earlier report).
- An old "Écluses sur les voies navigables bretonnes" (Brittany locks) dataset exists (Licence Ouverte 2.0) but
  is not maintained.
- Austria: viadonau DoRIS (earlier report). I did not find a separate BWB source.

### 2.11 Canada and US networks

- **USACE Waterway Network** (https://services7.arcgis.com/n1YM8pTrFmm7L4hs/arcgis/rest/services/Waterway_Networks/FeatureServer):
  links with river miles, waterway names and functional class. Useful to put river miles on US legs.
- **NRCan "Navigable Waterways"** and **DFO Small Craft Harbours** (OGL-Canada, see 6.3).

---

## 3. Notices and closures

### 3.1 USCG MSI products: Local Notices to Mariners as GeoJSON [probe][page]

- **URL:** the app is https://navcen.uscg.gov/msi . Files are under
  `https://navcen.uscg.gov/sites/default/files/msi/{layer}_{n}.geojson`. Note the bare host: `www.` redirects
  with a 301.
- **What it provides:** since Nov 2024, LNM data refreshes **every 15 minutes**; Light List data refreshes
  daily. Weekly PDF LNMs are no longer archived. The layers (point, line and polygon variants) are:
  - `bridge` (388 notices, 650 kB)
  - `hazNav` (148, e.g. "Shoaling Reported")
  - `msib`: Marine Safety Information Bulletins
  - `safeZone`
  - `marCon`: marine construction
  - `marEvent`
  - `tmpChange`, `change`, `changeAdvNot`
  - `discFedAid` / `discPriAid`: aid discrepancies
  - `navalAct`, `spaceOps`, `tessAdv`
  - `buoys_1…12`: Light List per district
- **Format:** each feature has `TITLE`, `SUB_CATEGORY`, `TYPE`, `WATERWAY_NAME`, `BEGIN_DATE`/`END_DATE` (epoch
  ms), `DESCRIPTION` (free text) and an IALA MRN waterway id.
- **Licence:** US federal, so public domain. I found no explicit licence statement [unverified].
- **Static or live:** **Action cache.** The files have no CORS header [probe].
- **Size and effort:** **S–M.** A GitHub Action every 1–3 h:
  - fetch `bridge`, `hazNav`, `msib`, `safeZone`, `marCon`, `marEvent` and `tmpChange`
  - keep active notices (now ≤ `END_DATE`)
  - simplify them, and publish `notices-na.json` (likely under 1 MB)
- **How it plugs in:**
  - Match to route edges by geometry, using a buffer.
  - List "Notices on this route (as of …)" in the brief and on lock and bridge cards.
  - Treat a safety zone that intersects the route and is active on the travel date as a warning.
  - Bridge notices cover drawbridge schedule changes and closures: high value on the ICW.
- **Caveat:**
  - Notices are free text; only the category and dates are structured.
  - The USCG says it no longer archives the weekly LNM.
  - Drawbridge *regulations* (33 CFR 117) are not in this feed (see 7).

### 3.2 NOAA ENC weekly updates and NGA MSI

- **NOAA ENC "One week" bundle** (23 MB): re-run the ENC-derived limits weekly.
- **NGA MSI API** (`msi.nga.mil/api/publications/broadcast-warn`, NAVAREA IV/XII warnings):
  - The site and API returned a 503 maintenance page during this session [unverified].
  - It is relevant only to offshore passages, such as a transatlantic one.

### 3.3 Europe: notices to skippers

- **EuRIS:** the earlier report's shortlist item 1 still stands. Nothing new to add.
- **ELWIS:** I could not confirm a public NtS web-service endpoint [unverified]. The NtS XML schema and WSDL are
  in EU Regulation 2018/2032, appendices C and D. Use EuRIS, which aggregates ELWIS.
- **VNF avis à la batellerie:** no open feed found (2.10). Use EuRIS.

### 3.4 Canada

- **Seaway** Notices to Shipping and Pleasure Craft Bulletins: HTML and PDF only, no feed found.
- **CCG NOTSHIP** (Notices to Shipping): not checked [unverified].
- **Parks Canada** closures: web pages only.

---

## 4. Water levels, currents and tides

### 4.1 NOAA CO-OPS: tides, currents, Great Lakes levels [probe][page]

- **URL:**
  - Data API: https://api.tidesandcurrents.noaa.gov/api/prod/datagetter
  - Metadata API: https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/
- **What it provides:**
  - **Observations:** water levels (6-minute, hourly, high/low), including Great Lakes stations on IGLD; met
    data; `air_gap` (bridge clearance sensors at some ports); OFS nowcasts and forecasts (`ofs_water_level`).
  - **Predictions:** tide predictions at **3,502 stations**, including subordinate ones, and **current
    predictions at 4,448 stations**, with max/slack.
  - **Harmonic constants:** `stations/{id}/harcon.json`, e.g. M2 0.671 m at The Battery.
- **Request limits:**
  - 6-minute data: 1 month per request
  - high/low predictions: 10 years
  - current max/slack: 1 year
  - CO-OPS "throttles … under heavy load". No key is needed; pass `application=Interway`.
- **CORS:** `access-control-allow-origin: *` on both the data API and the metadata API [probe].
- **Licence:** "information on government servers are in the public domain … NOS requests that attribution be
  given … shall not be modified in content and then presented as official government material" [page].
- **Static or live:** both.
- **Size and effort:** **S–M.**
  - **Offline:** in the pipeline, for each coastal harbour POI and tidal lock, pick the nearest prediction
    station and either:
    - store its harmonic constants (harmonic stations), with a small JS harmonic predictor in the app; or
    - precompute 12 months of high/low (about 1,400 events per station per year, roughly 8 kB compressed) for
      the stations near the network.
  - **Live:** when online, fetch high/low for the trip dates and current max/slack at passes (East River /
    Hell Gate, Cape Cod Canal, Deception Pass, Seymour Narrows is Canadian, see 4.4).
- **How it plugs in:**
  - POI panel and daily stages: "HW 10:36 1.6 m, LW 17:19".
  - A warning when a stage passes a strong-current pass against the stream.
  - Great Lakes current level against chart datum: Lakes Michigan and Huron above or below LWD changes the
    depth and bridge clearance available.
- **Caveats:**
  - Subordinate stations use offsets, not constants. Use the API's predictions there.
  - CO-OPS currents are point predictions.

### 4.2 USGS Water Data APIs (OGC API): US rivers [probe][page]

- **URL:** https://api.waterdata.usgs.gov/ogcapi/v0/ (collections such as `latest-continuous`,
  `monitoring-locations`). The legacy https://waterservices.usgs.gov/nwis/iv/ still answers, also with CORS `*`.
- **What it provides:** real-time stage (00065) and discharge at thousands of gauges. Values are provisional.
- **Access:** no key needed. A free key raises the rate limit (reported in `X-RateLimit-*` headers; 429 when
  exceeded) [page].
- **Licence:** USGS, public domain.
- **Live:** yes, CORS `*`.
- **Effort:** **S.**
  - Pipeline: snap gauges to graph rivers (`monitoring-locations` with a bbox).
  - App: fetch the latest stage for the 2–5 gauges on a route.
- **Caveat:**
  - Stage is in feet above gauge datum, not depth.
  - Use NWPS flood categories for meaning (4.3).

### 4.3 NOAA National Water Prediction Service (NWPS) [probe]

- **URL:** https://api.water.noaa.gov/nwps/v1/gauges/{lid} and `/stageflow`. For example, `EADM7` is the
  Mississippi at St. Louis, which maps to USGS 07010000.
- **What it provides:** forecasts of river stage and flow, and flood categories (action, minor, moderate,
  major).
- **CORS:** `access-control-allow-origin: *`. No key.
- **Licence:** NOAA, public domain.
- **Effort:** **S.** Show "forecast to reach flood stage on …" per river leg. High water closes locks on the
  Mississippi and Ohio and limits bridge clearance.

### 4.4 Canada: CHS IWLS and ECCC hydrometric [probe][page]

- **CHS IWLS** (https://api-iwls.dfo-mpo.gc.ca/api/v1/):
  - Covers tide predictions, observations and forecasts at Canadian water-level stations, plus benchmarks and
    datums.
  - CORS `*`.
  - Rate limit: 3 requests/s and 30/min per IP.
  - **SPINE** gives St. Lawrence forecasts for Montreal to Saint-Joseph-de-la-Rive.
  - **Licence** (https://tides.gc.ca/en/licence-agreement):
    - The data "shall not be used in the purpose of navigation".
    - Derivative products are allowed only "not for profit under any form whatsoever and not for navigation",
      with a prominent CHS notice.
    - Copyright "shall not be sold, licensed, leased, assigned or given to a third party".
  - **Live:** yes. Interway is free, so its use fits, with the notice.
  - **Static:** do not ship precomputed CHS tables. Fetch them live and cache them per device.
- **ECCC hydrometric real-time** (https://api.weather.gc.ca/collections/hydrometric-realtime/items):
  - Covers water level and flow, including the Ottawa, Rideau, Trent and Richelieu rivers.
  - CORS `*`.
  - **Licence:** ECCC Data Server End-use Licence, which allows commercial use and redistribution with
    "Data Source: Environment and Climate Change Canada" [page].
  - **Live and static:** yes.
- **Effort:** **S** each.

### 4.5 Europe: new findings only

- **CORS:** PEGELONLINE REST v2 sends `Access-Control-Allow-Origin: *`, and so does Hub'Eau hydrométrie
  [probe]. Both can be called live from the browser, which the earlier report left to check.
- **PEGELONLINE licence:** its own terms (Stand 21 May 2024) state **DL-DE→Zero-2.0**, and allow
  reproduction, editing, passing data on to third parties and use "in Geschäftsprozesse, Produkte und
  Anwendungen" (business processes, products and applications) [page]. That replaces the "unverified" note in
  the earlier report.
- **Rijkswaterstaat Waterwebservices:**
  - The old host `waterwebservices.rijkswaterstaat.nl` now **301-redirects to a migration page**
    (https://rijkswaterstaatdata.nl/projecten/waterwebservices-overschakeling/).
  - The new host is `https://ddapi20-waterwebservices.rijkswaterstaat.nl/METADATASERVICES/OphalenCatalogus`
    (POST JSON).
  - It answered without a CORS header [probe], and JSON POST would need a preflight. So it is
    **Action cache only**.

### 4.6 Tide models

- Covered in the earlier report (FES2022 heights for all uses; TPXO under licence).
- **New point:** in North America, CO-OPS harmonic constants (public domain) make global models unnecessary for
  US harbours. CHS covers Canada live, with no static redistribution.

---

## 5. Weather and sea state

| Source | Coverage | Browser use (CORS, key) | Licence | Notes |
|---|---|---|---|---|
| **Open-Meteo Marine and Forecast** (already used) | Global, including NA | CORS `*` [probe]; no key | Free tier non-commercial; < 10,000 calls/day, 5,000/h, 600/min, 300,000/month, **per IP**; CC BY 4.0 [page] | This session's shared IP got HTTP 429 "Daily API request limit exceeded". Per-user browser calls are fine, but never call it from a CI job. |
| **NWS api.weather.gov** | US coastal and Great Lakes marine zones, alerts | CORS `*` [probe]; no key (asks for a User-Agent, which browsers send as-is) | Public domain | `/zones/forecast/ANZ335/forecast` returns marine zone text periods ("SE winds around 5 kt … Seas 1 ft or less"). `/alerts/active?point=` gives Small Craft Advisories and gale warnings. **S**: in the pipeline, tag NA sea edges with marine zone ids from NWS zone shapefiles, then show the zone forecast and active advisories per sea stage. |
| **NWS text products** (tgftp.nws.noaa.gov) | Same | No CORS header [probe] | Public domain | Use the API instead. |
| **NOAA NDBC buoys** (`ndbc.noaa.gov/data/realtime2/{id}.txt`) | US and some Canadian buoys | **No CORS** [probe] | Public domain | Action cache of the latest observation for buoys near the network (wave height, period, wind). **S–M.** |
| **ECCC MSC GeoMet OGC API** | Canada | CORS `*` [probe] | ECCC End-use Licence, attribution | Collections `marineweather-realtime` ("Marine forecasts and warnings [experimental]"), `marine-standard-forecast-zones`, `weather-alerts`, `swob-marine-stations`. The Canadian counterpart to NWS. **S.** |
| **MET Norway** (`api.met.no/weatherapi/oceanforecast/2.0`) | Norwegian and Nordic seas | CORS `*` [probe] | CC BY 4.0 [page] | The terms allow "low-volume" browser calls identified by Origin or Referer, with no preflight, under 20 req/s total, coordinates truncated to 4 decimals. They prefer a proxy. Useful for the Telemark/Langesund coast; Open-Meteo already covers most of this. |
| **DWD open data** | Europe and global models | No CORS header [probe] | GeoNutzV, attribution | Pipeline or Action only (covered in the earlier report). |
| **Copernicus Marine** | Global | Needs an account (free), so no keyless browser use | Free including commercial use, with attribution | Pipeline only (covered in the earlier report). |

---

## 6. Ports and marinas

### 6.1 NGA World Port Index (Pub. 150) [unverified]

- **URL:** https://msi.nga.mil/Publications/WPI . The site and API returned **503** throughout this session.
- **What it provides:** per secondary sources, about 3,700 ports worldwide with:
  - entrance restrictions
  - channel, anchorage and pier depths
  - tide range
  - shelter
  - pilotage
  - services
  - Formats: Access, SHP and CSV.
- **Licence:** a US government work, so public domain. I could not reach NGA's own statement.
- **Effort:** **S** once the site is reachable. Join it to OSM harbour POIs by distance and name. Add channel
  depth and shelter to harbour cards, and use them in the transatlantic and North American coastal brief.
- **Caveat:** commercial ports only, with depth categories rather than exact values. Of little use for marinas.

### 6.2 USACE Navigation Facilities ("Docks") [probe]

- **URL:** https://services7.arcgis.com/n1YM8pTrFmm7L4hs/arcgis/rest/services/Docks/FeatureServer/0
- **What it provides:** 20,574 records: 72 marinas, 259 anchorages, 278 lock chambers and 52 bridges. Each has
  mile, waterway name, depth min/max and berthing length. Most are commercial docks.
- **CORS:** `*`. Public domain (USACE).
- **Verdict:** low value for leisure. The 259 anchorages and the river miles are the useful parts.

### 6.3 DFO Small Craft Harbours: Canada [page]

- **URL:** https://open.canada.ca/data/en/dataset/262451e7-6416-47b5-8453-f31d212ea657 (ESRI REST:
  `egisp.dfo-mpo.gc.ca/arcgis/rest/services/open_data_donnees_ouvertes/small_craft_harbours_en/MapServer`; GDB).
- **What it provides:** core and non-core fishing harbours and **recreational harbours**; updated March 2026.
- **Licence:** OGL-Canada (redistribution allowed with attribution).
- **Effort:** **S.** Add the missing harbours to POIs, especially in the Maritimes and Newfoundland, where OSM
  marinas are sparse.
- **Related:** "Coastal BC Marinas" (OGL-BC) is circa 2004 and "may not be accurate". Skip it.

### 6.4 NOAA Coast Pilot [unverified details]

- Free PDF volumes 1–10, public domain. They give anchorage, approach, bridge-clearance and local-knowledge text
  per waterway.
- I did not check for a structured or XML form.
- Use it as the source for hand-written NA waterway sheets, cited the same way as the European ones.

### 6.5 Commercial marina APIs (Marinas.com, Dockwa, ActiveCaptain)

- Not open-licensed; keys and terms are required [unverified].
- They fail the redistribution test. Skip them.

---

## 7. Filling the known gaps

- **NA sea depth:**
  - First GEBCO (S), at the same level as EMODnet today.
  - Then NOAA ENC `DEPARE`/`DRGARE` and the USACE NCF maintained depths for coastal, ICW and harbour edges.
  - CHS NONNA-100 for Canada, as a derived layer with the CHS notice.
  - BlueTopo only if ENC leaves gaps.
- **US and Canadian lock station data:**
  - USACE NTAD Locks for chambers and sills (S).
  - NYS Canal locks for phone numbers and lifts (S).
  - Parks Canada and Seaway as curated waterway sheets (manual; no open data).
  - IENC for chamber geometry on rivers.
- **Hours and bridge schedules in the US:**
  - Drawbridge operating schedules are federal regulations, 33 CFR Part 117 (public domain). They are published
    as text on eCFR, and eCFR has a JSON/XML API.
  - Structuring a few hundred ICW and NJ/NY/FL drawbridge rules into `opening_hours` is **M**, manual work, but
    high value for the ICW and Great Loop.
  - I did not probe the eCFR API in this session [unverified].
- **Transatlantic join:**
  - Depth is not the obstacle (GEBCO covers it).
  - What is missing is the network (sea-mesh nodes Iceland–Greenland–Newfoundland, or Azores–Bermuda) and
    route planning facts:
    - **Ice:** the International Ice Patrol / North American Ice Service daily iceberg and sea-ice limit, shp and
      KML on navcen.uscg.gov (node 31299), updated daily by 2200. US public domain. Exact file URLs not
      confirmed [unverified]. Use an Action cache.
    - **Seasonal climate:** NGA Atlas of Pilot Charts (public domain PDFs) or ERA5 monthly winds (Copernicus
      licence, attribution) for "usual months for a crossing" [unverified].
  - The brief should present an ocean crossing as an offshore passage outside Interway's planning scope, with
    distance only.

---

## 8. Top 10 by value to the app against effort

| # | Source | Value | Effort | Mode |
|---|---|---|---|---|
| 1 | **GEBCO_2026** (public domain) | Removes "depth unknown" from every NA sea leg and from any future transatlantic leg, with almost no new code (a second `DepthGrid` loader) | S | Static |
| 2 | **NOAA ENC S-57** (CC0) | Charted depth areas and dredged channels for US coastal, ICW, Great Lakes and harbour-approach edges, plus `VERCLR` bridge clearances; fixes "crosses dredged banks" and the depthless first 1.5 km | M–L (adds GDAL) | Static |
| 3 | **USACE NTAD Locks** (public domain) | Real chamber length, beam and sill depth for 234 US federal lock chambers, from one 234-row query | S | Static |
| 4 | **USCG MSI LNM GeoJSON** (public domain) | The first notices feed for NA: bridge works and drawbridge changes, shoaling, safety zones, marine events; refreshed every 15 min | S–M (Action cache) | Action |
| 5 | **NOAA CO-OPS** (public domain, CORS) | Tide high/low and current slack at US harbours and passes, plus Great Lakes levels against chart datum; can be packed offline from harmonic constants | S–M | Live + static |
| 6 | **USACE NCF maintained depths** (+ eHydro) | Maintained depth on every federal channel quarter; catches shoaled inlets and ICW reaches that ENC and GEBCO smooth over | S (NCF), M–L (eHydro) | Static (+ live shoals) |
| 7 | **Rijkswaterstaat FIS dataservice** (CC0) | Authoritative clearances for 4,348 bridge openings, 1,016 locks and 762 structured operating-hour sets for the densest bridge network in Europe, with no EuRIS token | M | Static |
| 8 | **CHS NONNA-100** | Canadian sea depth on chart datum (Atlantic Canada, St. Lawrence, BC); WCS fits `depth.py` | S–M | Static (derived, with notice) |
| 9 | **USACE IENC** (federal) | Bridge clearances, lock geometry and sailing line on 7,260 miles of the Mississippi, Ohio, Tennessee and other rivers | M (reuses #2's reader) | Static |
| 10 | **NA live conditions: NWS marine zones and alerts, ECCC marine, USGS, NWPS, ECCC hydrometric** (all CORS, no key) | Small Craft Advisories and zone forecasts per sea stage; river stage and flood forecasts per river leg (Mississippi high water closes locks) | S each | Live |

**Close runners-up:**

- NYS Canal data.ny.gov: S.
- DFO Small Craft Harbours: S.
- 33 CFR 117 drawbridge schedules: M, manual.
- BlueTopo: L.
- FHWA NBI navigation clearances: M.
- WSV WInD: S, but no dimensions.
- NGA WPI: S, but the site was down.

**Europe:** EuRIS NtS and operating times (earlier shortlist item 1) remain the top European item. This research
only adds that PEGELONLINE and Hub'Eau are callable directly from the browser.

---

## 9. Caveats

- **"Not for navigation" clauses** apply to GEBCO, BlueTopo, NCEI CRM, CHS NONNA and IWLS, NBI ("not for route
  clearance") and NOAA's chart display. Interway's label already fits; keep it on every depth- and
  clearance-derived figure.
- **CHS is the odd one out.**
  - NONNA and IWLS are non-commercial and not for navigation, with a mandatory notice. Their terms can be ended
    by public notice.
  - Keep CHS-derived data in a separable layer, show the notice, and do not redistribute raw CHS grids or tide
    tables.
- **Datums differ.**
  - ENC, NCF and NONNA use chart datum (MLLW, LWD or LWRP).
  - GEBCO uses mean sea level.
  - BlueTopo and CRM use mixed datums.
  - Gauges use gauge zero.
  - Do not mix them in one "depth" field without recording the source and datum per edge.
- **Units:** USACE data is in feet: lock dimensions, NCF depths, eHydro. Convert in the pipeline.
- **Rate limits and per-IP free tiers.** Open-Meteo (verified: this session's shared IP was blocked for the
  day), CO-OPS throttling, and the IWLS 30/min limit. Call them from users' browsers, never from CI. Cache per
  device and cache offline snapshots.
- **CORS facts** were checked from this session on 22 Nov 2026 and can change. `encdirect` and `charttools`
  echo the requesting origin rather than sending `*`.
- **Unverified items:**
  - NGA WPI (site down)
  - USACE LPMS and Corps Locks (502)
  - ELWIS NtS endpoint
  - the IIP file URLs
  - the 33 CFR 117 eCFR API
  - the BlueTopo COG layout
  - the exact NBI item numbers
  - the data.ny.gov licence
  - the RWS operating-times licence ("licentie onbekend")
  - the NOAA ENC user agreement text
- **Pipeline cost:**
  - S-57 (#2, #9) brings in GDAL as an optional dependency, with fixtures to keep the 100 % coverage rule.
  - BlueTopo and eHydro processing belongs on a CI runner with caching, not in the repo; the pack stays derived
    and small.
