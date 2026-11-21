# Interway for boat anglers: research and feature proposals

Checked 2026-11-21. Not legal advice. Anything marked *(verify)* is from memory or a secondary source and needs an
official source before it goes into the app. Licence prices change every year, so the app should link to the
issuer and not hard-code prices.

## 0. What Interway already has that anglers can use

- `app/public/data/pois.json`: 43,835 POIs, including **10,684 slipways**, 1,086 fuel points, 13,262 marinas,
  2,242 ports and 10,102 locks. These are the launch ramps and fuel anglers need. The extraction is in
  `pipeline/interway_pipeline/pois.py` (OSM `leisure=slipway`, fuel and harbour tags).
- `app/src/data/rules.json`: boating rules for 47 countries (licence, speed, alcohol, motorboat bans, sea rules,
  authority, sources, date checked). It has no fishing section. A few notes in `waterways.json` already mention
  fishing (Calanques no-take zones, Bonifacio, Karaburun–Sazan, Oslofjord cod ban, Turkish Straits, German Baltic
  wind-farm safety zones, Croatia's Mali Ždrelac).
- `pipeline/interway_pipeline/depth.py`: EMODnet DTM (CC BY 4.0, ~115 m grid) used for draft limits at sea.
  `docs/charts-research.md` §7 already plans EMODnet/GEBCO contours (`gdal_contour` at 2/5/10/20 m).
- Seamark tiles (OpenSeaMap), the `date=` departure parameter, GPS track recording, offline tiles along a route,
  share links and the llms.txt/WebMCP agent tools. All of these can be reused.

## 1. What boat anglers need

Sources: feature lists of Fishbrain, Navionics Boating, Garmin ActiveCaptain/Quickdraw, Deeper (Fish Deeper),
Anglers' Atlas, Fishing Points, and common forum requests (r/Fishing, PZW and Wędkarski Świat forums,
Anglerboard.de, Fisch & Fang). It also draws on the competitor survey in `docs/charts-research.md`.

| Need | How the apps provide it | Interway today |
|---|---|---|
| Spots and saved marks (waypoints with notes) | Fishing Points and Fishbrain (private, or public with rough locations), Navionics markers | Saved places and pins; no fishing type |
| Depth contours, drop-offs, humps and channel edges | Navionics SonarChart 0.5 m, Garmin Quickdraw and Deeper lake maps built from users' sonar logs | EMODnet at sea, used only in routing |
| Wrecks, reefs, rocks and other structure | Chart wrecks and obstructions, Fishing Points wreck lists | OpenSeaMap tiles (visual only) |
| Weather: wind, gusts, **pressure trend**, cloud, rain | Fishing Points and Fishbrain "bite forecast" combine pressure, wind and moon | None |
| Solunar times (moon transits), sunrise and sunset | Fishing Points, Fishbrain, almost every app | None (easy to compute) |
| Tide times and currents (coast) | Fishing Points, Navionics | None (planned in charts-research §2.4) |
| Water temperature | Fishing Points (SST), Deeper (sonar) | None |
| Launch ramps, parking, fuel | Navionics, Anglers' Atlas, Fishing Points | **Already there** (slipways, fuel) |
| Bait and tackle shops | Fishbrain, Google Maps | None (OSM `shop=fishing` exists) |
| Regulations: licence, closed seasons, sizes, bag limits, closed areas | Fishbrain (regulations in some US states, few in the EU), Anglers' Atlas (Canada, by water body). In Europe it is mostly national apps: VISplanner (NL), WIR (PL), Angeln in MV, svenskafiskeregler.se | Boating rules only |
| Catch log (species, length, weight, bait, photo, conditions) | Fishbrain (social), Fishing Points (private), Deeper | GPS track only |
| Trolling: tracks at 1.5–3.5 kn, repeating a productive line, depth along the line | Navionics, plotters | Route planning at any speed |
| Drift and anchoring: drift prediction from wind and current, anchor alarm | Fishing Points (drift), savvy navvy and Aqua Map (anchor alarm) | None |
| Privacy of spots | A key worry in every forum: people hide or blur marks, and Fishbrain coarsens public catch positions | n/a |

From forums and reviews: anglers will not log catches in a public app that shows the spot. They want offline use on
the water, a quick log entry with one hand, and plain answers to "may I fish here today, with what licence, and
what can I keep?". That last question has no good answer in any app across Europe. It is the gap where Interway's
researched-rules approach helps most.

## 2. Legal side by country

Two EU-wide rules apply first:

- **EU Fisheries Control Regulation (Reg. 2023/2842, Art. 55; Implementing Reg. 2025/274).** Since **10 January
  2026**, recreational sea fishers in EU coastal states must register and report catches of species under EU
  recreational measures electronically and daily. National or Commission lists cover species such as bluefin tuna,
  swordfish, sea bass, cod, salmon, eel, pollack and dolphinfish. The tool is the Commission's **RecFishing** app,
  or a national app in nine states (e.g. Spain's PescaREC). Rollout and enforcement vary: NL and PT apply it, while
  FR has postponed the practical effects. Gear other than handheld gear (nets, pots) must be marked. RecFishing has
  no public API. Interway must not pose as a reporting tool, but it can remind users and link to the app.
  https://oceans-and-fisheries.ec.europa.eu/news/questions-and-answers-recfishing-2026-01-12_en ,
  https://eur-lex.europa.eu/eli/reg_impl/2025/274/oj/eng
- **EU fishing opportunities for 2026 and 2027:** recreational **cod is banned across the whole Baltic**. Salmon in
  subdivisions 22–31 is limited to 1 adipose-fin-clipped salmon per day (from the Council text; check the final
  regulation). **Sea bass** (UK and EU Atlantic): 3 fish a day in 2026, closed in February and March, minimum 42 cm
  (Angling Trust and BASS statement; EU text Reg. 2026/266). Eel: national closures under the eel regulation.
  https://eur-lex.europa.eu/eli/reg/2026/266/oj , https://anglingtrust.net/2025/12/10/recreational-win-on-bass-but-troubling-bycatch-increases-cast-a-shadow/

Common patterns: almost everywhere **inland needs two things**, a state document (licence, card or fee) and a
water-specific permit from the fishing-rights holder (club, state agency or owner). **Sea fishing is often free**
but is registered more and more. Fishing near locks, weirs, dams, fish passes, harbour entrances and in buoyed
fairways is commonly banned or restricted. Trolling inland is usually allowed only on named waters.

| Country | Inland: state document + water permit | Sea from a boat | Closed seasons, sizes and areas (examples) | Official source; machine-readable? |
|---|---|---|---|---|
| **PL** | Karta wędkarska (not needed for foreigners staying temporarily) + permit: **Wody Polskie RZGW**, electronic only from 2026 via **WIR** (wir.wody.gov.pl and app; PDF with QR code; e.g. Kraków integrated permit 400 zł), or **PZW** district fee (okręg) | Baltic: permit from the Okręgowy Inspektorat Rybołówstwa Morskiego (OIRM) *(verify)*; cod ban; salmon limits | Pike 1 Jan–30 Apr, zander 1 Jan–31 May *(verify)*; no fishing within 50 m of weirs and dams *(verify)*; trolling only on waters a permit names; catch register (rejestr połowu) is mandatory | gov.pl/web/wody-polskie-*; RAPR permit rules per district. WIR has a map of fishery districts, but no open-data API was found |
| **DE** | **Fischereischein** (Land exam; Touristenfischereischein without an exam in MV, SH, BB, NI and others) + Fischereiabgabe + **Erlaubnisschein** of the water's owner or club | MV coast: Fischereischein + Angelerlaubnis Küstengewässer (day €6, week €12, year €30) online at erlaubnis.angeln-mv.de; SH similar | Länder-specific Schonzeiten (pike and zander mostly Feb/Mar–Apr/May); Baltic river-mouth closed areas (Schonbezirke); wind-farm zones | LALLF MV; Landesfischereiverordnungen. No national open data |
| **NL** | **VISpas** (Sportvisunie, the merged Sportvisserij Nederland + federations; Kleine VISpas ~€11.50 in 2025) + VISplanner (the free app is a legal permit together with the pass) | Free, but **RecFishing reporting mandatory since 10 Jan 2026** | National predator closure (no lures or dead fish) 1 Apr–last Sat of May; pike closed 1 Mar–30 Jun *(verify)* | RVO, Rijksoverheid. "Viswaterkaart Sportvisserij" is listed on data.overheid.nl, but the licence is unknown and access restricted |
| **BE** | Flanders: visverlof (ANB/INBO); Wallonia: permis de pêche (SPW) | Free from shore and boat | Regional closures (Flanders: closed for predators in spring) | natuurenbos.be, SPW. None found |
| **FR** | **Carte de pêche** (AAPPMA/FNPF, cartedepeche.fr) | Free; tail-clip marking compulsory for many species; RecFishing practical effects postponed | Pike: 2nd-category waters closed from the last Sun of Jan to the last Sat of Apr; national parks with no-take zones (Calanques, Port-Cros) | Préfectures, DDTM. Géolittoral/data.gouv has some MPA layers |
| **UK** | England and Wales: EA/NRW rod licence + permit; Scotland: no rod licence, permits only; NI: DAERA | Free (sea); IFCA byelaws in England | Coarse closed season on English rivers 15 Mar–15 Jun; bass rules as above; MPAs and protected wrecks | gov.uk; JNCC and Defra MPA boundaries under **OGL** |
| **IE** | Salmon/sea trout licence (IFI); coarse and pike mostly free | Free; bass 2 fish/day, min 40 cm, closed 15 May–15 Jun *(verify)*; RecFishing via IFI | Pike 1 fish/day >50 cm *(verify)* | fisheriesireland.ie. Open data limited |
| **AT** | Landes-Fischerkarte (or Gastfischerkarte) + Lizenz from the rights holder | n/a | Land-specific closures; trolling only on named lakes with permits | Länder fisheries laws. None found |
| **CZ** | Rybářský lístek (municipality) + povolenka (ČRS/MRS) | n/a | Pike and zander closed 1 Jan–15 Jun *(verify)* | MZe; ČRS district maps (PDF/web) |
| **HU** | Állami horgászjegy + területi jegy; turistahorgászjegy online (horgaszjegy.hu, MOHOSZ) | n/a | Pike 1 Feb–31 Mar, zander 1 Mar–30 Apr *(verify)* | MOHOSZ. Lake Balaton has its own rules (Balatoni Halgazdálkodási) |
| **HR** | Freshwater: HSRS/county permits | **Sea licence required from shore or boat**; daily, multi-day, monthly or annual; bought online from the ministry, serial number by e-mail (~€20–30/day; Lastovo park €30/day) | No fishing in Mali Ždrelac; national parks and MPAs; daily catch limit (5 kg *(verify)*) | gov.hr "Marine recreational and sport fisheries"; Ministry of Agriculture. Bioportal MPA layers |
| **IT** | Regional inland licence | Free, but the **MASAF "comunicazione"** (SIAN portal, SPID) is mandatory; RecFishing for bluefin, swordfish, albacore and dolphinfish | Regional and MPA zones A/B/C (AMP) | MASAF, regions. AMP boundaries on the MASE geoportal *(verify)* |
| **ES** | Regional (CCAA) licence | **CCAA licence** (per boat or person) + state authorisation for some species; PescaREC app for catches since Jan 2026 | Marine reserves (reservas marinas); CCAA closures | MAPA (mapa.gob.es pesca marítima de recreo); MITECO RAMPE MPAs |
| **PT** | ICNF inland licence | **DGRM licença de pesca lúdica** (embarcada); catch reporting via app since Feb 2026 | Area portarias in 2026 (e.g. Ria Formosa, Tejo) | dgrm.pt. Portarias as PDF only |
| **GR** | — | **Unclear**: the ministry FAQ talks of abolished licences but keeps restrictions; only Greek-flagged boats may fish recreationally in territorial waters; travel guides disagree | Port-authority rules; no spearfishing near ports and swimmers | alieia.hcg.gr FAQ, port authorities. Needs research before publishing |
| **SE** | Fiskekort from the fiskevårdsområde (fiskekartan.se) | **Free hand-gear fishing on the coast and in Vänern, Vättern, Mälaren, Hjälmaren and Storsjön** | Fredningsområden (HVMFS, annex 5); salmon and sea trout limits; Baltic cod ban | HaV, svenskafiskeregler.se (map), Länsstyrelsen PDFs. HaV publishes some geodata under **CC0**; no WMS for closed areas found |
| **NO** | Fiskeravgift for salmon/anadromous fish + local fiskekort | Free for tourists. **Export quota 15 kg in 2026 (twice a year), 10 kg from 2027**; only via a registered fishing-tourism business; no trophy-fish exemption | Cod ban in the Oslofjord and Skagerrak coast; minimum sizes | fiskeridir.no, toll.no. Fiskeridirektoratet has an open map service (Yggdrasil) with regulated areas *(verify)* |
| **FI** | **Kalastonhoitomaksu** (fishing management fee, eraluvat.fi) for lure fishing ages 18–64; rod and ice fishing free by everyman's right; trolling with several rods needs the water owner's permit | Same; sea salmon rules | Local restrictions | Luke, kalastusrajoitus.fi (map of restrictions). No API confirmed |
| **DK** | Fisketegn (ages 18–65) + owner permit inland | **Fisketegn** required at sea | **Fredningsbælter**: 500 m around river mouths (all year if the mouth is ≥2 m wide, else 16 Sep–15 Mar); sizes and closures by species | Fiskeristyrelsen, fiskepleje.dk. Zones only as PDF maps |
| **EE / LV / LT** | EE: püügikaart for spinning and trolling (simple hand gear free); LV: makšķernieka karte + licensed waters; LT: angler's card via the state e-service and app | Same cards at sea; Baltic cod ban | Spring spawning closures for pike (EE, LV, LT) *(verify)* | Kliimaministeerium (EE), VVD (LV), Aplinkos ministerija (LT). Little open data |

**Machine-readable data, in short:** none of these countries publishes closed seasons or minimum sizes as an API.
They are in decrees and PDFs, so Interway would research and maintain them by hand, as it does with
`rules.json`. Area data exists in places: NL Viswaterkaart (restricted), SE HaV geodata (CC0, but not the closed
areas), FI kalastusrajoitus.fi (map), UK JNCC/Defra MPAs (OGL), DK (PDF), PL WIR (web map). The cheapest broad
cover is EU-wide layers (section 3) plus a per-country table.

## 3. Open data for a fishing layer

| Data | What | Licence and terms | Fit |
|---|---|---|---|
| **OSM** (worldwide counts from taginfo, 2026-11-21) | `leisure=fishing` 19,965; `fishing=*` (yes 6.6k, no 3.8k, private 2.3k, licence/permit ~1.3k, catch_and_release); `shop=fishing` 7,655; `leisure=slipway` 69,247; `seamark:type=wreck` 8,495, `rock` 158k, `obstruction` 11.6k, `marine_farm` 6.1k, `fishing_facility` 817 (fish traps and nets: hazards); `seamark:restricted_area:restriction` with `no_fishing` ~250 ways in total, plus `no_anchoring` | **ODbL**: attribution, share-alike on derived databases. Fine, since Interway already ships OSM data | Quick win: same pipeline as pois.py |
| **EMODnet Bathymetry** DTM | ~115 m grid, European seas | **CC BY 4.0** | Contours at sea (2/5/10/20/50 m); drop-offs from slope. Too coarse for inland or small structure |
| **Rijkswaterstaat** 1 m inland bathymetry; NL IENC | NL rivers and lakes | Public domain / **CC0** | High-value NL depth overlay (already noted in charts-research) |
| **EMODnet Seabed Habitats** (EUSeaMap) | Substrate (rock, sand, mud) and habitat; *Posidonia* | **CC BY 4.0** | "Rocky bottom" structure hint offshore; also where anchoring harms seagrass |
| **EMODnet Human Activities** (WFS `ows.emodnet-humanactivities.eu/wfs`) | Wind farms, cables, pipelines, aquaculture, shellfish areas, fishing effort, FAO areas, MPAs, dredging, wrecks *(verify layer)* | **CC BY 4.0** (per-layer; check each record) | No-go zones (wind-farm safety zones, aquaculture), offshore structure. No layer of recreational fishing closures was found |
| **GFCM Fisheries Restricted Areas** | Mediterranean FRAs | GFCM terms *(verify)* | Mainly closures for trawlers; little use for anglers |
| **Natura 2000** (EEA) and **CDDA** (EEA, national protected areas) | Site boundaries and designation | EEA reuse policy, **CC BY 4.0**; some CDDA national records are restricted | "You are in a protected area: check local rules". Natura 2000 does **not** mean no fishing, so never label it that way |
| **WDPA / Protected Planet** | Global protected areas | **No commercial use and no redistribution or derived services without UNEP-WCMC permission** | Avoid. Use EEA plus national layers instead |
| National MPA layers | UK JNCC/Defra (OGL), FR (Géolittoral/OFB), ES (MITECO), IT (MASE), HR (Bioportal) | Mostly open (OGL, Etalab, CC BY) | Phase 2 for no-take zones (Calanques, AMP zone A, Spanish reservas marinas) |
| **Copernicus Marine** | SST, currents, waves, chlorophyll (daily, ~1–4 km) | Copernicus Marine licence: free, **commercial use allowed**, attribution required | Pipeline-side SST tiles or a point query through a small proxy |
| **Open-Meteo** | Forecast: wind, gusts, `pressure_msl`, cloud, precipitation. Marine: waves, `sea_surface_temperature`, ocean currents, sea level with tides (tested: Gulf of Gdańsk SST 8.8 °C) | Data **CC BY 4.0**; free API **non-commercial only**, <10k calls/day, attribution; paid plan for commercial | Simplest weather/SST/current card, called from the browser |
| Tides | Open-Meteo marine sea level (model, "not for coastal navigation"); FES2022 (AVISO, free registration) | as in charts-research §2.4 | Tide curve at coastal spots |
| **Solunar, sun and moon** | Computed (e.g. `suncalc`, BSD-2) | No data licence | Zero cost, works offline |
| **GeoNames** | Names of lakes, banks, reefs (`BNK`, `RF`, `SHOL`) | CC BY 4.0 | Search for named banks and reefs |
| Wrecks beyond OSM | UKHO wreck database (paid/restricted), SHOM (partly open), national heritage lists | Mostly not open | Leave out. Protected wrecks and war graves (UK Protection of Wrecks Act and Protection of Military Remains Act) can carry restrictions; label them in the layer |

## 4. Feature proposals, prioritised

### Quick wins (data already in the app or one pipeline step away; days each)

1. **Fishing layer and "Fishing" chip.** Extend `pois.py` with `leisure=fishing` (+ `fishing=*` access value),
   `shop=fishing` (tackle and bait shops), `seamark:type=wreck|obstruction` (with `seamark:wreck:category`, depth)
   and `fishing_facility|marine_farm` as hazards. Slipways and fuel are already in the data. Add a category chip
   ("Fishing": spots, tackle, slipways) and PlaceCard details. Cost: a few thousand POIs; ODbL is already handled.
2. **"Fishing rules here" card.** Add a `fishing` object per country to `rules.json` (inland document and issuer,
   water-permit issuer, sea rule, foreign-visitor rule, online purchase URL, RecFishing or national app, typical
   bans near locks and weirs and in fairways, trolling rule, export rules (NO), sources, checked date). Show it in
   PlaceCard and in the route itinerary per country crossed ("You enter Germany: Fischereischein + Erlaubnisschein;
   MV coast: buy online …"). The research method and UI already exist. Ongoing cost: a yearly re-check in
   January, when rules and prices change.
3. **Closed-season warnings by date.** A small table per country (and region where needed) of species, closed
   window, minimum size and bag limit, with a source. Use the trip `date=` or today's date to warn: "Pike and
   zander closed in Poland until 30 Apr / 31 May". Show it in the rules card and the AI brief. Keep it to the main
   predator species (pike, zander, perch, trout, salmon, sea trout, cod, bass, eel) to limit upkeep. Always say
   "local rules may be stricter".
4. **Conditions card for a spot or pin.** Wind and gusts, pressure with its 24 h trend, sunrise and sunset,
   **solunar** major and minor periods and moon phase (computed client-side, offline), and SST and waves at sea
   (Open-Meteo, called by the user's browser). Open-Meteo's free tier is non-commercial; Interway's free,
   non-commercial use fits, with attribution.
5. **Private catch log on the device.** IndexedDB records: time, position (taken from GPS or the pin), species,
   length and weight, released or kept, bait/lure, note, optional photo, and auto-attached conditions (wind,
   pressure, moon, SST). It shows as a private layer and exports to CSV/GPX/GeoJSON. **Nothing leaves the device**
   (no account, no server), which also avoids GDPR processing. A "Report in RecFishing" link for listed species at
   sea, with no claim that Interway does the reporting. Optional size check against the minimum-size table
   ("below 45 cm minimum").
6. **Share a spot as a link, with privacy.** Reuse the pin share URL. Add a "blur" option that rounds the position
   to ~1 km (or shares only the water body) and a warning before sharing an exact mark. Spots and log entries are
   never shared by default.

### Medium (weeks)

7. **Depth contour overlay with drop-off shading.** As charts-research §7: contours from EMODnet (CC BY) as vector
   tiles; slope shading for drop-offs and banks at sea; Rijkswaterstaat 1 m bathymetry for NL inland. Say clearly
   that contours are coarse offshore and missing inland elsewhere, and that inland depth depends on the water
   level. Cost: tile build time and hosting size (a few hundred MB for Europe at z≤12 *(estimate)*).
8. **"Where you may not fish" overlay.** OSM `restricted_area` with `no_fishing`, wind-farm safety zones (OSM and
   EMODnet HA), aquaculture, harbour areas and buoyed fairways (from the existing graph), DK fredningsbælter
   (digitised from PDFs, about 1,000 points: river mouth + 500 m), Natura 2000 shown as "protected: check rules",
   national no-take zones. Never present it as complete. Avoid WDPA because of its licence.
9. **Trolling and drift tools.** Trolling: plan or record a line, set 1.5–3.5 kn, show the time per pass and
   depth along the line (where contours exist), "repeat last pass" from the recorded track, and a warning when the
   line crosses a fairway or restricted area. Drift: predict the drift from wind (leeway) plus current
   (Open-Meteo/Copernicus) over 30–60 min and draw it from the boat. **Anchor alarm**: radius around the drop point
   using the existing GPS and Wake Lock code, also useful for every cruiser.
10. **Tides at coastal spots** (charts-research §2.4): a tide curve at a pin; slack-water times for wreck fishing.

### Larger or later

11. **Per-water permits and rules** (PL obwody rybackie with the RZGW/PZW permit link, NL Viswaterkaart, FI
    restrictions, SE fiskevårdsområden). This is the most valuable inland, but each needs data access or a
    licence agreement (the NL data is restricted). Ask the agencies.
12. **User sonar import** (Deeper, Garmin and Lowrance logs → private depth map). Large and proprietary formats.
    Skip unless there is demand.
13. **Community spots or catches:** do not build. It needs moderation, accounts and GDPR work, anglers distrust it,
    and it could steer pressure onto sensitive or closed areas.

### Limits and costs to state in the app

- Rules data is a summary: link the official source and the checked date; "local and water-specific rules may be
  stricter". The yearly upkeep is the main cost.
- Licences: OSM (ODbL attribution), EMODnet, EEA and Copernicus (attribution), Open-Meteo (non-commercial free tier
  plus attribution), no WDPA, and no scraping of club or permit portals without permission.
- Privacy: spots and catches stay on the device by default; blurred sharing; no analytics on positions.
- Not for navigation: depth overlays are planning aids.

## Key sources

- EU RecFishing Q&A: https://oceans-and-fisheries.ec.europa.eu/news/questions-and-answers-recfishing-2026-01-12_en
- Implementing Reg. 2025/274: https://eur-lex.europa.eu/eli/reg_impl/2025/274/oj/eng ; NL notice: https://business.gov.nl/amendment/saltwater-anglers-must-record-catches-via-app
- Baltic 2026/2027 (recreational cod ban): https://www.brusselstimes.com/2380418/eu-raises-crucial-baltic-fishing-quotas-but-keeps-cod-limits-strict ; Reg. 2026/266: https://eur-lex.europa.eu/eli/reg/2026/266/oj
- Norway export quota: https://fiskeridir.no/English/Fishing-in-Norway/Export-quota , https://www.toll.no/en/goods/fish/quota
- Croatia sea licence: https://www.gov.hr/en/marine-recreational-and-sport-fisheries/1542 ; Lastovo prices: https://pp-lastovo.hr/fishing-price-list/?lang=en
- Poland WIR permits: https://www.gov.pl/web/wody-polskie-poznan/zakup-zezwolenia-na-wedkowanie-online , https://www.gov.pl/web/wody-polskie-krakow/zezwolenie-zintegrowane
- MV permits: https://www.lallf.de/fileadmin/media/PDF/fischer/9_sonstiges/Broschuere-zbFS-MV_20260526.pdf , https://erlaubnis.angeln-mv.de/
- NL VISpas: https://www.government.nl/themes/economy/fisheries/applying-for-a-vispas-fishing-permit ; Viswaterkaart: https://data.overheid.nl/dataset/72095-viswaterkaart-sportvisserij
- Italy MASAF communication / RecFishing: https://www.money.it/multa-chi-pesca-senza-permesso-come-ottenere-licenza-non-correre-rischi (secondary)
- Spain: https://www.mapa.gob.es/en/pesca/temas/pesca-maritima-de-recreo/preguntas-frecuentes ; Portugal: https://dgrm.pt/documents/20143/121104/FAQ-Pesca+Ludica+2026.pdf/586f6137-df78-25e7-e7ad-8a3dcc1f9ffc
- Greece FAQ: https://alieia.hcg.gr/faq/faq_eng.php
- Sweden: https://www.havochvatten.se/en/our-organization/data-and-statistics/swedish-marine-planning---geographical-data.html , svenskafiskeregler.se ; Denmark: https://www.fiskepleje.dk/-/media/sites/fiskepleje/kyst/fiskeriregulering/lyst-og-fritidsfiskeri.pdf
- EMODnet Human Activities catalogue: https://emodnet.ec.europa.eu/geonetwork/srv/api/records/0d07002d-4aa1-4215-8915-1979d6ea5226
- WDPA terms: https://www.protectedplanet.net/c/terms-and-conditions
- Open-Meteo: https://open-meteo.com/en/docs/marine-weather-api , https://open-meteo.com/en/terms
- OSM taginfo: https://taginfo.openstreetmap.org/keys/fishing
