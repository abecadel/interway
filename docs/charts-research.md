# Commercial boating apps vs. what Interway can rebuild from open data

Research date: 21 Nov 2026. Prices are App Store or vendor list prices seen on that date. They vary by region and
change often, so treat them as ranges. "Not verified" means I found no primary source.

Interway today (from `app/public/llms.txt` and the repo): OSM-based inland and coastal auto-routing with vessel
dimension checks (draft, air draft, beam, length), lock and bridge lists, POIs (marinas, fuel, water, pump-out, with
OSM `opening_hours` already extracted in `pipeline/interway_pipeline/pois.py`), EMODnet depth on open-sea legs, an
AI brief and JSON export, WebMCP tools, a GPS navigation mode with re-routing, lock and bridge alerts, GPX track
recording, and offline map tiles along a route. It has no lock hours, closures, water levels, weather, tides or AIS.

---

## 1. What the commercial products offer

Key: ● = offered, ◐ = partly, paid add-on, or needs hardware, – = no or not found.

| Feature | Navionics Boating (Garmin) | C-MAP Boating (ex-Embark) | Garmin BlueChart g3 / ActiveCaptain | savvy navvy | Orca | Aqua Map | iNavX | NV Charts | Imray / ADMIRALTY | Inland apps (Waterkaarten, Wasserkarte Live, VNF Navi, NavShip, Canaux, ELWIS) | Navily |
|---|---|---|---|---|---|---|---|---|---|---|---|
| Vector or raster charts | ● vector | ● vector | ● vector (plotter) | ● | ● | ● (chart packs) | ● (many providers) | ● raster/vector | ● raster (Imray), ENC (AVCS) | ● (NL/BE/DE/FR/UK inland) | – |
| Depth contours, high-res bathymetry | ● SonarChart HD, 0.5 m contours | ● Reveal relief, custom depth shading | ● g3 Vision HD relief | ● | ● | ● | ● | ● | ● | ◐ | – |
| Community sonar charts | ● SonarChart Live | ◐ Genesis (Edge is paid) | ◐ Quickdraw | – | – | – | – | – | – | – | – |
| Auto-routing | ● Auto Guidance+ (dock-to-dock) | ● Easy Routing | ● Auto Guidance 3.0 (Vision) | ● | ● (engine 50/520/1300 NM per tier) | ● (Master) | ◐ | ● | – | ● VNF Navi, NavShip, Fluviacarte | ◐ (Premium itineraries) |
| Tides and currents | ● | ◐ | ● | ● heights (Explore), stream atlas (Elite) | ◐ | ● (Master) | ● (Tides & Currents) | – | ● (tidal data) | ◐ (Rhine water levels) | – |
| Weather and weather routing | ◐ forecasts, no routing | ◐ weather along route | – | ● weather+tide routing, 4- or 14-day | ● sail routing, 5- or 10-day | – | ◐ (GRIB) | – | – | – | ◐ (Premium forecasts, anchorage protection score) |
| AIS | ◐ (Wi-Fi receiver) | ◐ (Premium, C-MAP Traffic) | ● (plotter) | ● (3 NM, or unlimited on Elite) | ● internet AIS; CPA/TCPA on Smart Nav | ◐ | ◐ (AIS Live add-on) | ◐ (Wi-Fi receiver) | ◐ (separate app) | – | – |
| Marina info, booking | ◐ (ActiveCaptain POIs) | ◐ POIs | ● ActiveCaptain | ● marina and anchorage info | – | ● (ActiveCaptain, Waterway Guide) | – | ◐ community layer | ◐ (pilot notes) | ◐ | ● 700+ bookable marinas |
| Community reviews or edits | ● Community Edits, ActiveCaptain | ◐ | ● 179k+ reviews | – | – | ● (overlay) | – | ● | – | – | ● |
| Offline | ● | ● (Premium) | ● (card) | ● (Explore and up) | ● (Plus) | ● | ● | ● | ● | ● | ◐ (Premium) |
| Anchor alarm | – (not listed) | – (not listed) | ● (plotter) | ● (Elite) | – (not listed) | ● | ● | – | – | – | – |
| Track logging | ● | ● | ● | ● (500 or 1000 tracks) | ● (7 days or 5 years) | ● | ● | ● | ● | ◐ | – |
| POIs | ● | ● | ● | ● | ● | ● | ● | ● | ◐ | ● | ● |
| Notices to skippers, closures, lock hours | – | – | – | – | – | – | – | – | ◐ (chart corrections) | ● VNF Navi (lock hours, closures), Wasserkarte Live (notices, levels) | – |
| Price | $49.99–69.99/yr per region | $14.99/yr + regions $18.99–39.99; Genesis Edge $99/yr | $300–450 per card | £59 / £95 / £99 per yr | free / €49 / €149 per yr | free + charts €15–50, Master $15–25 | free + charts $30–60, AIS Live $99.99 | free + charts ~$50; NV Atlas Binnen ~€45–65 | Imray $40–45/yr per set; AVCS via distributor (~$1,500/yr regional, estimate) | Waterkaarten £44.99/yr; Wasserkarte Live €9.99/yr; NavShip $27.99/yr; VNF Navi free | free; Premium ~€10–25 |

### Sources for the table

- Navionics Boating: App Store listing (Auto Guidance+ "for planning purposes only", SonarChart HD 0.5 m, SonarChart Live, Community Edits/ActiveCaptain, weather and tides, Wi-Fi AIS with collision alerts, daily updates, plotter sync, track, offline; prices $49.99–69.99/yr per region). https://apps.apple.com/us/app/id744920098
- Community Edits, daily updates to cards, and ActiveCaptain with 179k+ reviews: https://www.garmin.com/en-US/blog/marine/activecaptain-community-a-boaters-best-friends/ ; ActiveCaptain data quality critique: https://panbo.com/?p=4533
- C-MAP Boating (formerly Embark): App Store listing (autorouting, tracks, weather along route, offline maps, AIS and C-MAP Traffic on Premium, Reveal, custom depth shading; $14.99/yr, regions $18.99–39.99). https://apps.apple.com/us/app/id967289980 . Genesis Edge at $99/yr and its features: https://www.wavveboating.com/blog/cmap-cost-pricing-guide/ (third-party). Easy Routing being subscription-free is a retailer claim: https://www.simrad-yachting.com/pl-pl/simrad/type/Mapping/
- Garmin BlueChart g3 Vision cards, $299.95–449.95 at retailers, with Auto Guidance: https://www.amnautical.com/products/garmin-bluechart-g3-vision-card , https://www.thegpsstore.com/GPS-Units/Hiking-Handheld-GPS/Garmin-BlueChart-G3-Vision-HD-Charts-C255.aspx
- savvy navvy tiers (Essential £59, Explore £95, Elite £99; weather and tidal routing; 4- or 14-day ECMWF forecasts; tide graphs; stream atlas; AIS 3 NM or unlimited; anchor alarm; marina and anchorage info; tracks): https://www.savvy-navvy.com/pricing
- Orca plans (Free, Plus €49, Smart Navigation €149; engine routing distance limits; sail routing; internet AIS; CPA/TCPA; offline; logbook): https://help.getorca.com/en/articles/6541858-subscription-prices-and-functionality
- Aqua Map (per-country EU charts €14.99–49.99, Master or Expert tiers, ActiveCaptain and Waterway Guide overlays, anchor alarm, tides and currents): https://apps.apple.com/us/app/id919552329 , https://www.noonsite.com/aqua-map/
- iNavX (free app, chart add-ons, AIS Live $99.99, Tides & Currents): https://apps.apple.com/us/app/inavx-marine-navigation/id286616280 , https://inavx.com/inavx-tides-currents
- NV Charts (free app, region IAPs ~$49.99, autorouting, Wi-Fi AIS, community layer; NV Atlas Binnen NL 7 €64.99): https://apps.apple.com/us/app/id659569095 , https://awn.de/en/products/nv-atlas-binnen-niederlande-sud-nederland-zuid-arnhem-maastricht-nl-7 , https://eu.nvcharts.com/binnenkarten/
- Imray Navigator (yearly chart subscriptions $39.99–44.99, quarterly corrections, AIS needs a separate app): https://apps.apple.com/app/id1184853123
- ADMIRALTY AVCS (per-cell 3/6/9/12-month licences through distributors): https://www.admiralty.co.uk/charts/admiralty-vector-chart-services-2 . The ~$1,500/yr regional figure is a third-party estimate: https://www.amnautical.com/a/s/blogs/the-mariners-blog/digital-chart-licensing-models-guide . UKHO's paper chart withdrawal was pushed back to at least 2030: https://www.pbo.co.uk/news/withdrawal-of-admiralty-paper-charts-delayed-until-2030-74464 , https://discover.admiralty.co.uk/news/paper-chart-withdrawal . I found no current price page for a product called "ADMIRALTY Leisure" (not verified).
- Inland apps: Waterkaarten (UK, NL, DE, FR, BE; £44.99/yr): https://apps.apple.com/gb/app/nautical-charts/id421372355 . Wasserkarte Live (notices and water levels; €9.99/yr): https://apps.apple.com/de/app/wasserkarte-live/id1401918195 . VNF Navi (free; route calculation with ETA, lock hours, closures, waiting times): https://apps.apple.com/app/id1550922830 , https://webzine.voyage/navi-application-navigation-fluviale/ . NavShip (500,000 km, routes capped at 40 km on the free tier, $27.99/yr): https://apps.apple.com/us/app/id1249883240 . Canaux (French canals, Saône add-ons $3.99–6.99): https://apps.apple.com/app/id1521219690 . Fluviacarte: only a secondary mention (ETA, lock counts); price not verified. https://webzine.voyage/navi-application-navigation-fluviale/
- Waterway Guide is aimed at North America (US, Canada and Caribbean editions at €59.99 each): https://apps.apple.com/app/id1551794976 . I found no product page for Bruce Navigation (not verified).
- ELWIS: the official app had not launched. Its services are web plus email/SMS alerts and are free. The "ELWISgo" app for leisure boating is in preparation: https://www.iala.int/?p=88213 , https://www.elwis.de/DE/Service/ELWIS-Abo/ELWIS-Abo-Informationsblatt.pdf
- EuroCanals: I could not reach the site. A third-party French canals map credits EuroCanals guides (Tom Sommers) for its data: https://enzocem.github.io/french-canals-map/french_canals_map.html (not verified).
- Navily (900k users, booking at 700+ European marinas, community reviews, Premium €9.99–19.99 for weather, itineraries and offline): https://apps.apple.com/us/app/navily/id881103205

**What this shows.** The sea apps compete on charts, depth, weather and tide routing, and AIS. None of them covers
the inland specifics: lock hours, notices to skippers, closures and water levels. Only national or single-country
inland apps do that (VNF Navi, Wasserkarte Live, ELWIS). That gap is where Interway is strongest, and it is where the
official open data is richest.

---

## 2. Can Interway rebuild each feature from free or open data?

Effort: S = days, M = 1–3 weeks, L = more than a month or ongoing operations.

### 2.1 Charts (vector chart rendering)

- **Feasible: partly.** Official IENC (S-57) data is free for most of Interway's inland area. Rendering it to
  web tiles needs an S-57 pipeline (GDAL's S57 driver to vector tiles, with S-52-like styling).
- **Sources:**
  - Germany, WSV/ELWIS IENC. Free under GeoNutzV ("geldleistungsfrei", no attribution needed). Inland ECDIS 2.4 ZIPs
    per waterway, plus a WMS. Revised at intervals, with an RSS feed. https://www.elwis.de/DE/Service/Inland-ENC-der-WSV/Inland-ENC-der-WSV-node.html
  - Netherlands, Rijkswaterstaat IENC. **CC0.** ZIP plus WMS. https://data.overheid.nl/en/dataset/55088-enc-van-nederlandse-binnenwateren , https://www.vaarweginformatie.nl/frp/main/#/page/infra_enc . Weekly-updated bathymetry for the Waddenzee, per Stentec 2023.
  - Austria, viadonau DoRIS. Free download (ES 2.5, with the 2WBD bathymetric layer). **"Not to be used for commercial purposes"**, under BEV licence. https://www.doris.bmimi.gv.at/en/inland-encs/downloads/inland-encs-inland-ecdis-standard-25
  - Other countries' download links, from the Stentec "Status Report European IENC 2023", appendix A1 (licences not verified for each):
    - France: VNF http://www.vnf.fr/ecdis/ecdis.html and Rhône www.inforhone.fr/Infos/CarteECDIS
    - Belgium: Flanders http://ris.vlaanderen.be/ , Brussels https://port.brussels/nl/scheepvaart/river-information-services-ris , Wallonia http://geoportail.wallonie.be/catalogue/3d57a714-7786-4da0-a144-2813fcc8a0b1.html
    - Poland: Szczecin, dated 2016 and probably stale, http://ang.szczecin.uzs.gov.pl/files/422_ienc_18042016.zip
    - Czechia: http://mapy.spspraha.cz/lpm/maps_S57.asp?lang=en
    - Slovakia: https://www.svp.sk/
    - Hungary and Croatia: http://www.vodniputovi.hr/en/ris/enc-charts/
    - Serbia: http://www.plovput.rs/electronic-navigational-charts
    - Romania: http://afdj.ro/en/content/inland-enc
    - Bulgaria: http://appd-bg.org/
    - Switzerland: https://port-of-switzerland.ch/hafenservice/schifffahrtsservice/inland-enc-hochrhein/
    - Report: https://www.stentec.com/anonftp/pub/wingpsinland/Status_Report_European_IENC_2023.pdf
  - Sea: NOAA ENCs are free and public domain, but US only, so of no use for Europe. https://nauticalcharts.noaa.gov/learn/faq.html . European sea ENCs (UKHO, SHOM, and the others) are sold through PRIMAR/AVCS, so there is no free route. OpenSeaMap seamarks (ODbL, already in Interway's OSM input; OpenSeaMap tiles are CC BY-SA 2.0): https://wiki.openstreetmap.org/wiki/OpenSeaMap , https://www.openseamap.org/index.php?L=1&id=faq
- **Effort:** M for a WMS overlay toggle (DE and NL publish WMS, so no processing). L for self-rendered IENC tiles
  across all countries.
- **Caveats:**
  - Austria's licence bars commercial use. Interway is free, but check before redistributing derived tiles.
  - The Polish IENC appears to date from 2016.
  - IENC coverage is CEMT class Va and above. Small leisure canals are not in it, and OSM stays the only source there.
  - Keep the "not for navigation" label: displaying ENCs in a non-type-approved viewer is not ECDIS.

### 2.2 Depth contours and bathymetry

- **Feasible: yes at sea (already partly done). Partly inland.**
- **Sources:**
  - Sea:
    - EMODnet DTM (CC BY 4.0, ~115 m grid). Already used at ~0.5 km. Contours and finer sampling are an
      incremental step. Licence noted on EMODnet catalogue records: https://emodnet.ec.europa.eu/geonetwork/srv/api/records/386fe2aa-84c4-4cea-9e22-fcba4d5f2e75
    - GEBCO 2025 (public domain, attribution required, commercial use allowed, "must not be used for navigation"): https://www.gebco.net/data-products/gridded-bathymetry/terms-of-use
    - UKHO ADMIRALTY Marine Data Portal: survey surfaces under OGL, but with an extra term that they are "not suitable for use in marine navigation or in the creation of navigational products". https://www.gov.uk/guidance/inspire-portal-and-medin-bathymetry-data-archive-centre
  - Inland:
    - Rijkswaterstaat 1 m inland bathymetry (public domain): https://data.overheid.nl/dataset/54518-bathemetrie-nederland---binnenwateren-1-mtr--nederland---januari-2025
    - Austrian and Czech Danube/Elbe bIENC
    - German IENCs carry depth areas
    - PEGELONLINE publishes fairway depths ("Fahrrinnentiefen" and "Tauchtiefen", the `F`/`T` timeseries) for the Elbe to Oder. https://www.pegelonline.wsv.de/webservice/dokuRestapi
- **Effort:**
  - M: EMODnet contour overlay plus a nearshore depth check from EMODnet at full resolution.
  - M: daily fairway-depth figures for German rivers in the brief.
  - L: general inland depth.
- **Caveats:**
  - The UKHO data carries the "no navigational products" term. Read it before using it in routing, or avoid it.
  - Inland depth depends on the water level, so a static depth is misleading without the gauge reading.
    Community sonar (SonarChart, Genesis) cannot be rebuilt without users' sonar logs.

### 2.3 Auto-routing (dock-to-dock)

- **Feasible: already done.** This is Interway's core, and inland it does more than Navionics or C-MAP, with lock
  and bridge clearance checks.
- **Gaps against the commercial apps:**
  - Sea routing on a coarse network with no harbour approach depth.
  - No time-dependent routing (lock hours, tides, weather).
- **Sources:** as now (OSM ODbL, EMODnet).
- **Effort:** see items 2.5, 2.6 and 2.9.
- **Caveat:** Navionics labels Auto Guidance+ "for planning purposes only". Interway's "Not for navigation" sits in
  the same place.

### 2.4 Tides and tidal streams

- **Feasible: partly. Licences are the main obstacle.**
- **Sources:**
  - FES2022 (AVISO/CNES): ocean tide heights and loading are "available for all uses" under the AVISO licence after
    registration. Tidal currents are not distributed except on request for science. Attribution text is required.
    https://www.aviso.altimetry.fr/en/data/products/auxiliary-products/global-tide-fes.html . The prediction
    software (pyfes) is under CeCILL. https://github.com/CNES/aviso-fes
  - FES2014: currents were limited to science or non-commercial use (Ifremer record): https://sextant.ifremer.fr/geonetwork/srv/api/records/b75834bc-50b4-4a78-8bd1-d20e5b24c9fd
  - TPXO: the OSU software and models are under a licence agreement, and the OTIS/OTPS software is non-commercial.
    https://ftp.tugraz.at/pub/ITSG/oceanAndAtmosphericTides/models/TPXO10_OCN/00README.txt
  - Port predictions:
    - SHOM: a paid or separately licensed service, not Licence Ouverte. SHOM's sea-level observations and its
      surge forecasts are under Licence Ouverte 2.0. https://www.service-public.pf/dgen/les-hauteurs-deau-sur-data-shom-fr/ , https://shom.fr/sites/default/files/inline-files/REPERTOIRE_2021_2025_VF.pdf
    - UKHO UK Tidal API Discovery: free for 1 year; 607 UK stations; HW/LW for today plus 6 days. Caching is not
      allowed, and UKHO copyright applies. https://api.gov.uk/ukho/uk-tidal-api-discovery/ , https://developer.admiralty.co.uk/faqs
  - Model tides:
    - Open-Meteo Marine: sea level including tides, from Météo-France SMOC at ~8 km. Warns "not suitable for coastal
      navigation". Free API is non-commercial, data CC BY 4.0. https://open-meteo.com/en/docs/marine-weather-api , https://open-meteo.com/en/terms
    - Copernicus Marine (free, including commercial use, attribution required): https://marine.copernicus.eu/user-corner/service-commitments-and-licence
- **Effort:** M for tide height curves at harbours from FES2022, precomputed per POI in the pipeline. L for tidal
  streams. Copernicus/SMOC currents at 8 km are too coarse for the Solent or the Channel Islands.
- **Caveats:**
  - Global models are poor in estuaries and harbours, where tides matter most.
  - Official harmonic constants for European ports are generally not open.
  - Show tides as a planning aid: "check the almanac".

### 2.5 Weather and weather routing

- **Feasible: yes for forecasts along a route and a departure window. Full isochrone sail routing is heavier.**
- **Sources:**
  - ECMWF open data: IFS 0.25° and, from 20 Oct 2026, 0.1°. Includes wave fields. CC BY 4.0 plus ECMWF terms,
    commercial use allowed with attribution. https://www.ecmwf.int/en/forecasts/datasets/open-data
  - DWD open data: ICON, ICON-EU, and the EWAM/GWAM wave models. Free, no registration, GeoNutzV, attribution
    required. https://opendata.dwd.de/README.txt , https://gdk.gdi-de.org/geonetwork/srv/api/records/urn:x-wmo:md:de.dwd.nwv.ewam.SWH
  - Copernicus Marine: waves and currents.
  - Open-Meteo: an easy JSON front end to the models above. Free tier is non-commercial, under 10k calls per day,
    CC BY 4.0. https://open-meteo.com/en/terms
  - Météo-France: also available through Open-Meteo (MFWAM). Its own open data is on meteo.data.gouv.fr (licence not
    checked).
- **Effort:**
  - S: wind and wave forecast per daily stage and leg in the brief, through Open-Meteo, called from the browser.
  - M: "best departure in the next 5 days" scoring by wind and wave limits per boat.
  - L: true isochrone routing with polars.
- **Caveats:**
  - Open-Meteo's free tier is non-commercial. Interway is free, which fits, but heavy use needs self-hosting
    (Open-Meteo is open source) or direct ECMWF/DWD GRIB processing.
  - Models are coarse near coasts and do not resolve local effects (Mistral, Bora, katabatic winds).

### 2.6 Notices to Skippers, closures, stoppages

- **Feasible: yes. This has the highest value for inland boating.**
- **Sources:**
  - EuRIS portal APIs (13 countries): Notices to Skippers, fairway objects (locks, bridges, berths), dynamic
    information (water levels, bridge clearance, discharge), and routing. **Free, treated as open data.**
    - Access: Personal Access Token from a free account. Tokens last up to 1 year.
    - Required attribution: "API/Service [name] incorporated from EuRIS (eurisportal.eu)".
    - Renewed portal and APIs since 9 Dec 2025.
    - https://www.eurisportal.eu/content/about/api , https://developer.eurisportal.eu/docs , https://www.viadonau.org/en/newsroom/news/detail/euris-portal-for-inland-navigation-introduces-new-release
  - EU Regulation 2018/2032: member states must publish NtS online through a standard web service (XML schema by
    CCNR). https://www.legislation.gov.uk/eur/2018/2032/data.html , https://www.ccr-zkr.org/files/documents/workshops/wrshp181011/Leaflet_NtS_de.pdf
  - viadonau DoRIS Open Service Portal (Swagger; try-out key "opendata"; API key on request): https://opendata2.doris-info.at/swagger-ui/index.html , https://www.doris.bmimi.gv.at/en/services/ris-open-services
  - UK Canal & River Trust stoppages: web pages and email alerts. I found no official API (a third-party scraper
    exists). https://canalrivertrust.org.uk/notices , https://github.com/onthecut/reservoir
  - France (VNF) small canals: the Navi app and web "avis à la batellerie". I found no documented open API.
- **Effort:** M. Needs a small proxy or cron job: the token must not ship to the browser. A GitHub Action could
  fetch every few hours into a static JSON file on GitHub Pages, keeping Interway serverless. Then match the notices
  to route edges by ISRS location code or geometry.
- **Caveats:**
  - EuRIS covers the TEN-T and CEMT network. Leisure-only canals in FR and UK, and Polish waters, may be missing.
  - Notices change daily, so show the fetch time.
  - Check that redistributing the JSON publicly fits the EuRIS terms. The terms "encourage" use, but a static
    re-host should be confirmed.

### 2.7 Lock and bridge operating hours

- **Feasible: partly.**
- **Sources:**
  - EuRIS fairway objects include locks and bridges. Regular operating times appear on the portal. The NL datasets
    "reguliere bedieningstijden" and "kortstondige wijzigingen" point to EuRIS. https://data.overheid.nl/en/dataset/53978-vervoersnetwerken---reguliere-bedieningstijden-van-sluizen-en-bruggen---eurisportal
  - Rijkswaterstaat FIS/VNDS: ArcGIS FeatureServer and WFS. VNDS navigability data is CC0; the licence of the
    operating-times layers is "unknown". https://data.overheid.nl/en/dataset/49337-vaarweginformatie-sluizen
  - OSM `opening_hours` on locks and bridges. Interway already reads `opening_hours` for POIs.
  - Germany: ELWIS publishes lock information on the web. https://www.elwis.de/DE/dynamisch/Schleuseninformationen/Informationsblatt-deutsch.pdf
  - France: VNF publishes hours per region as PDFs. https://cd08.fr/sites/default/files/services-et-horaires-de-navigation-2024-sur-le-reseau-de-vnf-dans-le-nord-est-fr.pdf
- **Effort:**
  - S: OSM `opening_hours` on locks, plus an "arrives after closing" warning per daily stage. The JS
    `opening_hours` library is LGPL.
  - M: EuRIS operating times.
  - L: time-dependent routing that waits at closed locks.
- **Caveats:** OSM coverage of lock hours is patchy, and seasonal hours change.

### 2.8 Water levels and gauges

- **Feasible: yes.**
- **Sources:**
  - Germany, PEGELONLINE REST v2 (`https://pegelonline.wsv.de/webservices/rest-api/v2`):
    - Contents: stations, current level, 31-day history, forecasts (`WV`, up to ~48 h plus longer estimates),
      fairway depths
    - Access: JSON, no registration
    - Licence: DL-DE Zero 2.0 per the Hessen open-data mirror. Data unverified.
    - Docs: https://www.pegelonline.wsv.de/webservice/dokuRestapi , https://opendata.hessen.de/dataset/metadata/pegelonline
  - France, Hub'Eau Hydrométrie (`/api/v2/hydrometrie/observations_tr`):
    - Contents: Vigicrues/PHyC, ~3,000 stations, refreshed every 5 min, 1 month of history
    - Licence: Etalab Licence Ouverte, per data.gouv.fr
    - Docs: https://hubeau.eaufrance.fr/page/api-hydrometrie , https://www.data.gouv.fr/dataservices/hubeau-hydrometrie
  - Netherlands, Rijkswaterstaat Waterwebservices (`waterwebservices.rijkswaterstaat.nl`): free, public domain per
    dataset metadata; a migration is planned. https://developer.overheid.nl/apis/rijkswaterstaat-wm-ws-dl , https://data.overheid.nl/dataset/9442-waterinfo-rijkswateren
  - Poland, IMGW `danepubliczne.imgw.pl/api/data/hydro/`:
    - Attribution is mandatory.
    - The terms limit free data to private, non-commercial use, except for "high-value datasets".
    - Check whether hydro counts as high-value under the EU HVD regulation.
    - https://danepubliczne.imgw.pl/apiinfo
  - Danube: DanubeHIS aggregator (WaterML 2.0, CSV; registration) https://danubehis.org/about ; DoRIS international
    water levels https://www.doris.bmimi.gv.at/en/fairway-information/water-levels/international-water-levels ;
    Hungary hydroinfo.hu (no API found).
  - EuRIS dynamic fairway information (water levels, bridge clearance).
- **Effort:**
  - S–M: nearest relevant gauge per river leg, with current level, trend and forecast in the brief.
  - M: adjust bridge clearance and available draft with the gauge reading where reference levels exist. For
    example, Rhine bridge clearances are given at HSW, and EuRIS has dynamic bridge clearance.
- **Caveats:**
  - Levels are relative to gauge zero, and converting them to fairway depth needs per-gauge reference values
    (GlW, HSW).
  - Readings are unverified real-time data.

### 2.9 AIS

- **Feasible: in principle, but costly to run. Low value for route planning.**
- **Sources:**
  - aisstream.io: free WebSocket, API key, beta, no SLA. The docs say not to call it from the browser because the
    key would leak, so it needs a relay server. https://aisstream.io/documentation
  - Norway, Kystverket: NLOD, free, no registration; public data covers 12 NM and ships over 45 m.
    https://kystverket.no/en/navigation-and-monitoring/ais/access-to-ais-data
  - Denmark, DMA: historical AIS free to download, with source attribution. https://www.dma.dk/safety-at-sea/navigational-information/ais-data
  - Global Fishing Watch: CC BY-NC 4.0, hourly presence only, ~3–4 day delay. https://globalfishingwatch.org/our-apis/documentation/docs/license-rate-limits
  - EMODnet vessel density maps (CC BY 4.0, yearly; credit EMODnet and CLS) are useful as a static "busy shipping
    lane" layer: https://emodnet.ec.europa.eu/geonetwork/srv/api/records/0f2f3ff1-30ef-49e1-96e7-8ca78d58a07c , https://marineinfo.org/doc/dataset/8494
- **Effort:**
  - S: EMODnet density raster overlay, plus a brief hazard line for "crosses a high-traffic lane".
  - L: live internet AIS. Needs a server, does not fit a static site, and should not be used for collision avoidance.
- **Caveat:** internet AIS has gaps and latency. Real collision avoidance needs an onboard receiver. The phone app
  could read NMEA from a Wi-Fi AIS receiver through a WebSocket bridge (Signal K), but browsers cannot open raw TCP.

### 2.10 Marina info and booking

- **Feasible: info, yes. Booking, no.** Booking is a commercial integration, as with Navily.
- **Sources:** OSM `leisure=marina`, `seamark:small_craft_facility:*`, `opening_hours`, `capacity`, VHF and
  website tags (already extracted), plus Wikidata links. EuRIS has berths.
- **Effort:** S. Show website, phone and VHF links ("call to book") and missing-data prompts.
- **Caveat:** OSM marina details are sparse, but no worse than ActiveCaptain's critiqued completeness (Panbo).

### 2.11 Community reviews and edits

- **Feasible: yes, by pushing edits upstream to OSM rather than hosting reviews.**
- **Sources:** OSM itself. Deep links to the iD editor or "Add a note" through the OSM Notes API (ODbL).
- **Effort:** S for "Report a problem here", which opens an OSM note at a lock or bridge. M or more for hosted
  reviews: that needs a backend, moderation and GDPR work, so avoid it.
- **Caveat:** edits reach Interway only on the next pipeline build.

### 2.12 Offline

- **Feasible: done for map tiles.** Make sure the route graph and POIs work offline, and add offline weather and
  notices snapshots taken at download time. S.

### 2.13 Sonar charts

- **Not feasible cheaply.** Needs users' sonar logs and processing (SonarChart, Genesis). Skip.

### 2.14 Anchor alarm

- **Feasible: yes, browser-only.** Geolocation API, a radius circle, and Vibration/Audio, reusing the navigation
  mode's GPS and alert code (`app/src/nav/alerts.ts`).
- **Effort:** S.
- **Caveat:** mobile browsers suspend background JavaScript and GPS when the screen locks, so it needs a Wake Lock
  and the screen on. That is less reliable than a native app. Say so in the UI.

### 2.15 Track logging

- **Done** (GPX track in navigation mode). Optional extra: a logbook summary of distance, engine hours and locks
  passed, from the track plus the route. S.

### 2.16 POIs

- **Done** (OSM). Possible additions:
  - OSM `amenity=sanitary_dump_station`, `waterway=water_point` and `waste_disposal` (some may already be covered)
  - Slipways: `leisure=slipway`
  - Waiting pontoons at locks: `mooring=waiting`
  - Wikidata or Wikipedia town blurbs
- **Effort:** S.

---

## 3. Shortlist: most value for least effort, in order

1. **Notices to Skippers and closures on the route (EuRIS plus DoRIS).**
   - Why first: this is the inland data no sea app has, it is official and free, and it answers "can I get through
     next week?".
   - Plan:
     - Register a EuRIS account and create a PAT.
     - Add a scheduled GitHub Action (every 3–6 h) that pulls current NtS with limitations (closures, maximum
       length, draft or air-draft limits) and fairway objects. Normalise them to JSON with ISRS code, geometry,
       validity window and limitation values, and publish them next to the graph on GitHub Pages.
     - In the router, match notices to edges and structures by ISRS code, with a nearest-geometry fallback.
     - In the brief, list "Notices on this route (as of <time>)". Treat a full closure valid on the travel date as
       a blocking edge, with an option to ignore it. Apply dimension limits like existing lock limits.
     - Add the EuRIS attribution line.
   - Effort: M.

2. **Water levels and forecasts at the gauges a route passes (PEGELONLINE, Hub'Eau, RWS, EuRIS).**
   - Plan:
     - In the pipeline, snap gauge stations to the waterway graph once.
     - In the browser, fetch the current level, trend and the PEGELONLINE `WV` forecast for the 2–5 nearest
       gauges on the route. These APIs need no key, so the browser can call them directly. Check each API's CORS
       first, and fall back to the Action cache if needed.
     - Show them per leg in the brief, with a warning when a level is above a navigation stop mark (HSW) or below
       low-water reference values. Those thresholds come from ELWIS station metadata where available.
     - Where available, show PEGELONLINE's daily fairway or immersion depths for the Elbe and Oder against the
       boat's draft.
   - Effort: S–M.

3. **Lock and bridge opening hours, with "arrives after closing" checks.**
   - Plan:
     - Extract `opening_hours` (and `opening_hours:*` seasonal variants) on lock and movable-bridge nodes in the
       pipeline, as is already done for POIs.
     - Evaluate them in the browser with the `opening_hours` JS library against the ETA of each daily stage.
     - Flag a stage when it reaches a lock outside its hours, and suggest ending the day at the previous mooring.
     - Phase 2: fill gaps from EuRIS operating times (NL and DE first) through the same Action cache.
     - Phase 3: time-dependent routing that adds waiting time at closed structures.
   - Effort: S for OSM, M for EuRIS.

4. **Wind and wave forecast along the route, with a departure-window score (Open-Meteo, then ECMWF/DWD).**
   - Plan:
     - For sea legs and big lakes (open-sea legs, plus IJsselmeer, Lake Constance, Vänern), sample one point per
       ~20 km.
     - Call Open-Meteo forecast and marine endpoints from the browser for the planned departure and the next
       5 days: wind speed and gusts, direction, significant wave height and period.
     - Score each departure hour against user limits (for example wind ≤ 15 kn, waves ≤ 1 m for `coastal=1`
       boats). Show a 5-day strip, and add the forecast to the AI brief and JSON with CC BY attribution.
     - If usage grows, self-host Open-Meteo or move to ECMWF open data. Both are CC BY 4.0 and allow commercial
       use.
   - Effort: S–M.

5. **Anchor alarm (browser).**
   - Plan:
     - Add an "Anchor here" button that records the position after averaging GPS for 30 s and sets a radius
       (default 30 m plus rode length).
     - Use the Screen Wake Lock API, reuse the navigation mode's geolocation watcher and alert sound or
       vibration, and alarm when the position moves beyond the radius or GPS goes stale.
     - Draw the swing circle and track on the map.
     - State clearly that the screen must stay on and that it is not a substitute for an anchor watch.
   - Effort: S. It matches paid tiers (savvy navvy Elite, Aqua Map Master) for almost no cost.

6. **Tide heights at coastal harbours and tidal reaches (FES2022).**
   - Plan:
     - Register with AVISO, download the FES2022b ocean tide constituents and accept the licence. Heights are
       "all uses", with the required citation.
     - In the pipeline, precompute harmonic constants (amplitude and phase for ~34 constituents) at each coastal
       harbour POI and at tidal river mouths. This gives a few kB per site.
     - In the browser, predict HW/LW and a 3-day curve with a small JS harmonic predictor.
     - Show it in the POI panel and brief, and warn for a draft-limited harbour approach or a tidal lock (e.g.
       Thames, Seine, Elbe).
     - Validate against SHOM or UKHO published tables for a few ports. Label it "model tide, check the almanac".
       Skip tidal streams.
   - Effort: M.

7. **Static traffic and bathymetry overlays (EMODnet vessel density, EMODnet or GEBCO contours, optional DE/NL IENC WMS).**
   - Plan:
     - Generate vector depth contours (2, 5, 10, 20 m) from EMODnet DTM tiles with GDAL `gdal_contour`, and serve
       them as PMTiles.
     - Add the EMODnet annual vessel-density raster as an optional layer, and add a brief hazard line when a sea
       leg crosses the top-decile density cells (shipping lanes, TSS).
     - Offer the WSV and Rijkswaterstaat IENC WMS endpoints as an "official chart" toggle on the map. They are free
       (GeoNutzV and CC0) and need no processing.
   - Effort: M.

8. **"Report a problem" through OSM Notes, plus marina contact actions.**
   - Plan:
     - On every lock, bridge and POI, add a button that opens an OSM note at that location with a prefilled text
       (for example "clearance wrong", "lock closed permanently").
     - Show the website, phone and VHF channel from OSM as action links ("call to book").
     - This builds a community-edit loop that improves Interway's own source data without a backend.
   - Effort: S.

**Not recommended for now:**
- Live internet AIS: needs a server, key handling and an uptime commitment, and has little planning value.
- Hosted reviews or booking: needs a backend, moderation and commercial deals.
- Sonar charts: needs user sonar data.
- Tidal streams: no open data of the needed quality.
- Full isochrone sail routing: large effort, and savvy navvy and Orca already do it.

**Licence hygiene for all of the above:**
- Add attribution lines in the app and in the brief:
  - EuRIS
  - ECMWF / Open-Meteo (CC BY)
  - AVISO FES2022 citation
  - IMGW (mandatory text)
  - EMODnet and CLS
  - GEBCO
- Keep "Not for navigation" prominent. GEBCO, EMODnet, UKHO portal data and Open-Meteo tides all carry
  no-navigation clauses.
- Avoid viadonau IENC derivatives and Polish IMGW data in anything that might later become commercial.
