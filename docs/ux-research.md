# Interway: a look-and-feel proposal

Date: 2026-11-21. Based on the local dev build (`npx vite --port 5199`, app/public/data) rendered with Playwright on iPhone 13, Pixel 7 and a 1440×900 desktop, in light and dark mode. All files are in this folder.

**Screenshots of the app as it is now.** Files are named `<device>-<scheme>-<step>.png`:
`01-start`, `02-search`, `03-place` (Giżycko), `03b-place-expanded` (actually the peek state after a tap), `04-route`, `05-route-summary`, `06-summary-expanded` / `06b` / `06c` (every `<details>` open, Steps open, scrolled down to the brief and exports), `07-directions`, `08-nav`.

**Mockups.** Each is a self-contained HTML file with a PNG render:
- `mockup-place.html` / `.png`: the phone place card with a Fishing tab, light and dark.
- `mockup-route.html` / `.png`: the phone route summary, light and dark.
- `mockup-symbols.html` / `.png`: the map symbol set, plus navigation mode in day, dark and helm-night (red).

Size scale used throughout: **S** is half a day or less, **M** is 1–2 days, **L** is 3–5 days.

---

## 1. What looks unpolished today

### Map
- **POIs are plain 5 px circles in 15 colours** (`MapView.tsx` lines 185–195). Two blues mean marina or port, and the other hues are hard to tell apart without a legend. With 44k POIs (13k marinas, 10k slipways, 10k locks) the dots swamp the route at z8–11; see `desktop-light-05`, where blue marina dots sit right on top of a blue route. There is no clustering.
- **Locks on the route use a different style** from locks among the POIs: a yellow circle with a dark stroke versus a yellow circle with a white stroke. The speed-limit ring (`limits`) is a third visual language again.
- **Labels in dark mode are wrong.** POI labels and alternative-route labels use a hard-coded `#234` text colour on a `#fff` halo, so on the dark basemap they glow white (`iphone-dark-08-nav`, "St Bruno", "Przystań u Czesława"). The route colours (`#0b57d0` / `#4c8df6`) and the network colour (`#0a8`) are hard-coded too.
- **Water barely reads as water in dark mode.** On the OpenFreeMap `dark` style, water is near-black next to grey land (`desktop-dark-03-place`). For a boating app, water should be the colour you read first.
- **Start and end are not clearly marked.** A route from a URL shows no A or B pin, only the line. The alternative's label ("7 h 27 min") is drawn across the route line.
- **The OpenSeaMap raster seamarks are busy at z14** (`iphone-dark-03`, red and blue raster icons). That is acceptable, but they clash with our own POI dots at the same places.
- **`fitBounds` ignores what covers the map.** It uses `padding: 60` (`MapView.tsx:279`) regardless of the 408 px side panel or the phone bottom sheet. On the phone, the half-height sheet hides the southern half of the route (`iphone-light-05`).
- **The place view sometimes opens on empty tiles.** `flyTo` goes to zoom 14 and the screenshot showed blank land and water for a few seconds (`iphone-light-03`, `desktop-dark-03`), with no loading indicator.

### Sheets and cards
- **The phone sheet animates `height` with `.2s ease`** (`App.css` `.sheet.bottom`). That is a layout animation with no velocity or spring. Dragging only works on the 20 px tall grip (measured at 390×20 px). The body does not drag, and there is no fling: the sheet snaps by distance only (`sheetSnap.ts`).
- **The peek state duplicates and clips content.** The handle shows the title ("Giżycko"), then the card's own `h2` "Giżycko" appears below it, cut off halfway through the action pills (`iphone-dark-03b`).
- **The place card is a stack of small grey lines.** Raw coordinates sit as the second line, "Fishing here" is a `<details>` triangle, and the footer under every card shows debug-like text ("Europe: 272,649 nodes, 1,998,050 edges"). The action row scrolls sideways and hides "Share" and "Share approx." off-screen.
- **The route summary is a wall of amber text** (`iphone-light-05`, `desktop-light-05`). It holds up to six separate `.warn.small` paragraphs, and the seasonal-closure warning alone runs to about 10 lines of near-duplicate "closed as of 2026-11-21, see About the waterways". The amber text is what you see first, so it buries the 7 h 0 min figure, the Start button and the route options.
- **The route options chips repeat the headline.** They read "7 h 0 min · 57 km · best", which duplicates the big number right below. The alternatives are not named.
- **Long `<details>` blocks expand inline in plain body text.** "About the waterways (4)" has a `dt` column of 7.5em, long paragraphs and 15–20 inline source links per waterway (`06c`). There is no inner hierarchy, no summary line and no "show more".
- **The directions card on phone shows coordinates instead of names** ("54.0381°N 21.7644°E → 53.6504°N 21…"). The point inputs have 28 px secondary pills ("My position", "Pick on map").
- **The start screen is plain text.** There is a coloured `h1`, a tagline, three lines of help, a plain "Open snapshot" link and a "My catches (0)" button. It has no visual focus, no recent places and no onboarding.

### Navigation mode
- It is the strongest screen already: a green banner, data tiles and a bottom bar. Problems:
  - The lock is a text label ("LOCK") with no symbol.
  - The data tiles show "–" with no context.
  - "Voice off" is a text button.
  - The red ✕ stop button uses a text glyph.
  - It has no helm-night (red) mode, only dark.

### Visual system
- **Icons are a mix.** About 20 Material filled paths in `icons.tsx`, plus text glyphs `✕` (in 7 places: CatchList, CategoryChips, DirectionsCard, NavPanel, PointInput, App.tsx:553) and `✓` ("Copied ✓"). Category chips have no icons, and the itinerary uses coloured words ("Marina", "Fuel") instead of symbols.
- **There are no tokens for type, spacing or radius.** Sizes are ad hoc: 0.8 / 0.85 / 0.9 / 0.95 / 1.05 / 1.15 / 1.3 / 1.4 / 1.6 / 1.7 / 1.9 rem. Radii are 6 / 8 / 10 / 12 / 14 / 16 / 18 / 24 px and `1em`. Colours outside `:root` are hard-coded in CSS (`.stop-lock .kind{color:#b38600}`, `.nav-stop{background:#d93025}`) and in MapLibre paint.
- **Buttons have five or more ad-hoc variants:** `button`, `.pill`, `.pill.primary`, `.chip`, `.fab`, `.icon-btn`, `.round`, `.exports .primary`, `.add-stop`.

### Accessibility (measured)
- **Tap targets under 44 px** on iPhone 13:
  - The sheet handle: 20 px tall.
  - Category chips: 31 px. Route-option chips: 31 px.
  - Action pills: 36 px. The close button: 36×36. The Directions button in the search pill: 38×38.
  - `<summary>` rows: 23–28 px. Export buttons: 34 px.
  - The 15 px tall inline source links are packed tightly.
- **No `:focus-visible` style anywhere** in `App.css` or `index.css`, and `button:hover` only changes the border.
- **No `prefers-reduced-motion` handling.**
- **No `aria-live` region** for "Calculating route…", route errors or "Link copied".
- **Contrast:** most token pairs pass AA (muted `#5c6b7a` on white ≈ 5.4:1, warn `#8a5a00` ≈ 5.6:1). The failures are the 11 px map labels without halo control in dark mode, and `.badge` outlines.

---

## 2. What the best apps in this genre do

| Pattern | Who does it well | Takeaway for Interway |
|---|---|---|
| A **three-detent bottom sheet with spring physics**: velocity-aware fling, a draggable body, content that scrolls only at full height, and a peek that shows one useful line (name and ETA) | Apple Maps, Google Maps | Replace the `height` transition with transform-based spring snapping. Make the whole header drag. The peek shows the title row only, never clipped content. |
| A **place card hierarchy**: big name, a one-line category and context, a row of 3–4 *equal* action buttons (filled primary and tonal secondaries), then tabs (Overview / Reviews / Photos / About) | Google Maps, Apple Maps, Navily (marina card: tabs for info, services, reviews) | Use Overview / Fishing / Nearby tabs, put coordinates in Overview, and move Share to an icon button. |
| **Category chips with icons** that also filter the map | Google Maps, Navily, Aqua Map | Use the same badge glyph in the chip, on the map and in lists, so people learn one symbol. |
| **Map POIs as coloured badges with a white glyph and a white outline**, a shape that encodes the kind, clustering at low zoom, and a larger selected state | Google and Apple Maps; Navionics / Garmin (marina, fuel, ramp icons) | Symbol layers with icon images and GeoJSON clustering. |
| **Route summary**: the time is the hero, distance and arrival secondary, alternatives as **named, selectable** options shown on the map, warnings **collapsed into one severity-coloured banner** with a count, and a single big Start button | Google Maps (warning chips such as "toll road"), savvy navvy (route card with time, distance and tidal timing; route details one tap away) | Show one notice card ("4 canals closed for the winter ›"), add stat chips with symbols, and present Along-the-route as a timeline. |
| **A timeline itinerary**: a vertical rail with symbol nodes and km or ETA on the left | Google transit directions; Waterway Guide (mile markers); savvy navvy (waypoint list) | Replace the `.stops` grid with a rail of symbols. |
| **Night modes for the helm**: muted charts with high contrast (Garmin); Orca's dark mode switches charts **and UI** to a dark red palette because red light disturbs night vision least; savvy navvy's night mode is a darker low-glare scheme | Orca, Garmin, savvy navvy | Add a third "Helm (red)" theme beside Auto, Day and Night. |
| **Water-first colour**: water is the most saturated area of the map, land is neutral, hazards are red, structures yellow or ochre (as on paper charts) | Navionics, Aqua Map, OpenSeaMap | Tint the dark basemap's water navy, and keep the category hues tied to chart conventions. |
| **Fishing day at a glance**: a solunar timeline bar with major and minor periods, a "now" marker and the best times, plus sun, moon and weather tiles | Fishbrain (forecast "BiteTime"), Fishing Points | Show the existing `solunar()` data as a bar instead of a sentence. |
| **Motion**: camera `flyTo` with easing, the route drawing itself in, sheet and card cross-fades, skeletons while loading | Google and Apple Maps | Add small, purposeful motion, disabled under `prefers-reduced-motion`. |

---

## 3. Proposals, prioritised by impact and effort

### P1. Map symbols instead of circles, with clustering. Impact: very high. Effort: M (1.5–2 days)
**What to change.**
- **Symbols.** Draw each POI as a 26 px badge: a coloured fill, a 2 px white outline and a white 24-grid glyph. Encode the kind with shape:
  - circle for facilities;
  - rounded square for structures (lock, bridge, fish farm);
  - diamond for hazards (wreck, obstruction).

  The symbol set is the left panel of `mockup-symbols.png`.
- **Zoom behaviour.**
  - z8–11: dots only, or clusters.
  - z12 and above: badges.
  - z13 and above: labels.
  - The selected POI is drawn at 1.3× scale.
- **Clustering.** Turn on GeoJSON clustering for `pois` (`cluster: true, clusterMaxZoom: 11, clusterRadius: 40`). Clusters are circles that show the count; tapping one calls `easeTo` with `getClusterExpansionZoom`.

**Where in the code.**
- **`map/MapView.tsx` ~185–200.** Replace the `pois` circle layer with:
  - a `symbol` layer (`icon-image: ['concat','poi-',['get','type']]`, `icon-allow-overlap` false, `symbol-sort-key` by importance, so locks and fuel win over slipways);
  - `poi-clusters` (circle) and `poi-cluster-count` (symbol) layers.
- **`map/MapView.tsx` 229–233.** Draw the on-route `locks` with the same `poi-lock` image, plus a route-coloured halo.
- **New `map/sprites.ts`.** Build the images at runtime from inline SVG strings. Render each to a canvas at 2× and call `map.addImage(id, img, {pixelRatio: 2})` on `style.load`. This needs no build step, works offline, and is about 1 KB of paths per icon. Use plain RGBA images rather than SDF, because each badge has two colours (fill and glyph). SDF only gives one tintable colour, so you would need two stacked layers per POI, which costs more.
- **Labels.** Make `text-color` and `text-halo-color` theme-dependent: dark mode uses text `#cfe0ee` on halo `#0f151b`. Pass the colours from tokens.

**Size: M.**

### P2. Route summary hierarchy: one notice banner, stat chips, named alternatives. Impact: very high. Effort: M (1–1.5 days)
**What to change** (see `mockup-route.png`).
- **Hero.** The time at 28/34 bold in the route-time colour. Below it, "57 km · 30.6 NM · at 10 km/h · back ≈ …" in 13/18 secondary text.
- **Alternatives as a segmented control:** "Best · 7 h 0 min" | "Via Mikołajki · 7 h 27". Name each alternative after its most distinctive leg name, using `route.legs`. On the map, show "+27 min" as a pill on the grey alternative instead of the absolute time.
- **Stat chips with symbols:** 4 locks, 2 fuel, 22 marinas, 5 slipways. Take the counts from the itinerary. Each chip is tappable and scrolls to that stop type in the timeline.
- **Merge all warnings into `<Notices>`.**
  - Show one card for the most severe notice: closed is error, seasonal or no-motor is warn, snapped or unverified is info.
  - The card has a title ("4 canals closed for the winter"), a one-line summary and "+ N notes".
  - Tapping it opens a sheet page that lists each notice as a row with an icon.
  - De-duplicate the per-waterway closure strings: group them by status and date.
- **Actions.** Start is full width at 48 px. Steps is tonal. Share is an icon button.
- **"Along the route" timeline.** A vertical rail with badges, km on the left, name and detail on the right, and a "Closed" pill on waterway nodes. The first 5 items are shown, followed by "Show all 34".
- **Accordion rows** for "About the waterways · 4 · 3 closed", "Rules · Poland" and "Export & offline · GPX, brief, offline map". Each has a leading icon tile, a one-line summary and a chevron, and opens in place or as a sheet page.

**Where in the code.**
- `ui/RouteSummary.tsx`: restructure. Move the warning logic into a pure `notices(route, profile, waterways)` that returns `{level, title, detail}[]`. `ui/notices.ts` already exists, so extend it.
- `ui/ItineraryView.tsx`: timeline markup.
- `App.css`: replace the `.summary`, `.legs`, `.stops*` and `details.more` styles.

**Size: M.**

### P3. Bottom sheet physics and states. Impact: high. Effort: M (1–2 days)
**What to change.**
- **Animate `transform: translateY` with the sheet at its full height**, not `height`. During a drag, follow the pointer 1:1. On release, project the velocity: the target is the snap nearest `y + v·0.2 s`. Then animate with a critically-damped spring (stiffness ≈ 400, damping ≈ 40, or a CSS `cubic-bezier(.2,.9,.25,1)` over 280 ms if you want no JS loop).
- **Make the whole header drag**, not just the grip. Make the handle area 44 px tall.
- **Body scroll locking:** the body scrolls only at `full`. A downward drag at `scrollTop === 0` moves the sheet instead.
- **Peek** shows a single 64–72 px header row: title, subtitle, close. Do not show a clipped body. Fix the duplicated title by not rendering the handle text when the body header is visible.
- **Rubber-band** past the top and bottom detents.
- **Under `prefers-reduced-motion`,** snap without animating.
- **Map padding follows the sheet:** call `map.setPadding({bottom: sheetHeight})` on the phone and `{left: 424}` on desktop, so `fitBounds`, `flyTo` and follow mode keep the route visible. This also fixes the half-hidden route.

**Where in the code.**
- `ui/Sheet.tsx`: pointer handlers, velocity, transform. `ui/sheetSnap.ts`: `nearestSnap(height, screen, velocity)`. Both have tests.
- `App.css` `.sheet.bottom*`.
- `map/MapView.tsx:279` and `:308` (`fitBounds` and `flyTo`): pass `padding` from a new `insets` prop.

**Size: M** (L if you add a gesture library such as `@use-gesture/react` + `react-spring`; plain pointer events are enough).

### P4. One icon set (Lucide) across the UI, chips and lists. Impact: high. Effort: S–M (1 day)
**What to change.**
- Replace the Material filled paths and the text glyphs (`✕` ×7, `✓` ×2) with **Lucide** outline icons. Lucide is ISC-licensed, 24 px grid, 2 px round stroke, and has about 1.6k icons including `anchor`, `sailboat`, `ship`, `fuel`, `droplet`, `toilet`, `bridge`, `dam`, `life-buoy`, `fishing-hook`, `fishing-rod`, `fish`, `waves`, `wind`, `sunrise`, `sunset`, `moon`, `navigation`, `route`, `layers`, `locate-fixed`, `share-2`, `star`, `x`, `chevron-*` and `triangle-alert`.
- Keep them inline in `ui/icons.tsx` (copy the paths; about 30 icons is roughly 6 KB, with no dependency). The alternative is `lucide-react` with tree-shaking.
- The `Icon` component switches to `fill="none" stroke="currentColor" stroke-width={2}`.
- Add the category badge to every category chip, search result row, category list row and itinerary row (`CategoryChips.tsx`, `SearchBar.tsx`, `ItineraryView.tsx`), sharing a component `<PoiBadge type=… size=…/>` with the map sprites.

**Where in the code.** `ui/icons.tsx`, plus the 7 files that use `✕`.

**Size: S** for the swap, **M** with badges everywhere.

### P5. Design tokens: colour (day / dark / helm-red), type, spacing, radius, elevation, buttons. Impact: high. Effort: M (1.5 days)
**What to change.** Extend `index.css :root`. The values are in `base.css` of the mockups (embedded in each mockup HTML).
- **Colour.**
  - Surfaces: `--bg`, `--surface`, `--surface-2`.
  - Text: `--fg`, `--fg-2`, `--fg-3`.
  - Lines and accent: `--line`, `--accent`, `--accent-fg`, `--accent-soft`, `--accent-soft-fg`.
  - Status: `--ok`, `--warn-bg`, `--warn-fg`, `--warn-line`, `--err`, `--err-bg`.
  - Map: `--water`, `--land`, `--route`, `--route-casing`.
  - The POI category colours (table in §4).
- **A third theme, `data-theme='helm'`.**
  - Every surface is black or very dark red, and every text and icon is in red (`#ff6b5e`, `#d2463b`, `#a3342b`), with no blue or white anywhere.
  - On the map: `.maplibregl-canvas{filter: grayscale(1) sepia(1) hue-rotate(-50deg) saturate(5) brightness(.55)}`. This is the quick version: one CSS line, and it also covers the raster seamarks. A proper red MapLibre style can come later.
  - Badges use the same filter.
  - Offer it in Layers → Colours as "Helm (red)", and auto-suggest it in navigation mode after sunset (`astro.ts` already computes sunset).
- **Dark basemap.** After `style.load`, call `setPaintProperty` on the OpenFreeMap dark style's `water` layer to `#0f2c42`, so water reads as water.
- **Type scale** (system font, `font-variant-numeric: tabular-nums` for all numbers):

  | Role | Size / line height | Weight |
  |---|---|---|
  | xl | 28/34 | 700 |
  | l | 22/28 | 700 |
  | m | 17/22 | 650 |
  | body | 15/21 | 400 |
  | small | 13/18 | 400 |
  | xs | 12/16 | 400 |
  | overline | 11/14 | 700, caps, +.06em |

  This replaces the 11 ad-hoc rem sizes.
- **Spacing:** a 4 px scale (4, 8, 12, 16, 24, 32). Sheet side padding is 16.
- **Radius:** 8 for inputs, 12 for cards and tiles, 20 for sheet tops, 999 for pills.
- **Elevation:** e1 for chips and tiles, e2 for floating cards and FABs, e3 for the sheet.
- **Buttons: exactly four kinds**, all at least 44 px tall:
  - `primary` (filled accent);
  - `tonal` (accent-soft);
  - `outline`;
  - `icon` (40 px visual inside a 44 px hit area).

  Chips are 36 px visually with a 44 px hit area through `::after` padding.

**Where in the code.**
- `index.css`.
- `App.css`: replace the hard-coded hex values in `.stop-*`, `.nav-stop`, `.my-position` and `.map-type .thumb`.
- `ui/useTheme.ts`: add `'helm'`.
- `map/MapView.tsx`: read colours for paint through `getComputedStyle(document.documentElement)` on theme change.

**Size: M.**

### P6. Place card and the progressive disclosure of long sheets. Impact: high. Effort: M (1.5 days)
**What to change** (see `mockup-place.png`).
- **Header.** 22/28 name. Subtitle "Town · Masurian lakes · 0.3 km to the water". The close and share buttons are 40 px circular icon buttons.
- **Actions.** Three action buttons: Directions (primary), Start (tonal), Save (tonal). "Share approx." moves into the share menu, as a sheet with "Exact location" and "Approximate (≈1 km, no name)".
- **Tabs.** *Overview* holds facts, coordinates (tap to copy) and the OSM facts as icon rows. *Fishing* holds the panel. *Nearby · N* holds the nearest POIs by category.
- **Fishing tab.**
  - A **day bar** from 00 to 24: daylight shading, major and minor solunar blocks, and a red "now" line. Above it, the line "Best: 12:40–14:40".
  - Three tiles: Sunrise, Sunset, Moon (phase and %).
  - A dashed "Wind, pressure & water temp: loads from Open-Meteo when you tap" card. This is the empty state; once loaded it becomes tiles.
  - "Log a catch" as a tonal button.
  - "Fishing rules in Poland ›" as a list row that opens a sub-page.
- **Waterways and rules sheets:** each waterway is a card with a name, a status badge, a 2-line summary and "More ›". The details sit behind it, in groups: Gauge / Current / Locks / Season / Closures. The 15–20 inline source links collapse into "Sources (17)". Apply the same pattern to RulesView and FishingRulesView.
- **Remove the data status line** ("Europe: 272,649 nodes…") from every sheet. Keep it in Layers → About data.

**Where in the code.** `ui/PlaceCard.tsx`, `ui/FishingPanel.tsx` (add a `DayBar` component that uses `solunar()` and `dayEvents()`), `ui/WaterwaysView.tsx`, `ui/RulesView.tsx`, `ui/FishingRulesView.tsx`, and the waterway sheet at `App.tsx` ~548–565.

**Size: M.**

### P7. Motion: route draw-in, camera, chip and card transitions, skeletons. Impact: medium–high. Effort: S–M (1 day)
- **Route draw-in.**
  - Set `lineMetrics: true` on the `route` source and animate `line-gradient` with a `step` on `line-progress` from 0 to 1 over about 600 ms with ease-out (the MapLibre `line-gradient` example; the Mapbox "cinematic route" technique carries over).
  - At the same time, `fitBounds` with `duration: 800` and the padding from P3.
  - Alternatives fade in 150 ms later.
- **Camera.** For a search result or tapped POI, use `flyTo({curve:1.4, speed:1.2, essential:false})`. For nearby moves, use `easeTo` (≤1.5 km). Never fly when `prefers-reduced-motion` is set: use `jumpTo`.
- **Cards and chips.**
  - The sheet content cross-fades and slides 8 px over 180 ms when its context switches (explore → place → route).
  - Chips have a 120 ms background and colour transition and `transform: scale(.97)` on `:active`.
  - Use the View Transitions API (`document.startViewTransition`) where it is supported, falling back to plain CSS.
- **Skeletons.**
  - While routing, show a summary skeleton: a 28 px bar, two 13 px bars and grey chip shapes, with a shimmer. This replaces the "Calculating route…" text.
  - While weather loads, use skeleton tiles.
  - While map tiles load after `flyTo`, show a thin progress bar under the top bar (`map.on('dataloading'/'idle')`).
- **Global rule:** wrap `@media (prefers-reduced-motion: reduce){*{animation:none!important;transition:none!important}}` and check a `reducedMotion` flag in JS for camera moves and draw-in.

**Where in the code.** `map/MapView.tsx` (`applyRoute`, `fitBounds`, `flyTo`), `App.css`, `App.tsx` (the busy state).

**Size: S** for CSS plus camera, **M** with the draw-in and skeletons.

### P8. Accessibility pass: targets, focus, live regions, labels. Impact: high (and it underpins everything else). Effort: S (0.5–1 day)
- **44 px minimum targets.** Use `min-height:44px` on `.pill`, `.chip`, `summary`, `.icon-btn` and the export buttons. Raise the sheet handle hit area to 44 px. Give the inline source links `padding-block: 6px` or collapse them as in P6.
- **Focus.** Add `:focus-visible{outline:3px solid var(--accent);outline-offset:2px}` to all interactive elements, with a red variant in helm mode.
- **Live regions.**
  - `aria-live="polite"` on a status region for "Calculating route…", the route result ("7 hours, 57 km, 4 locks"), "Link copied" and weather loaded.
  - `aria-live="assertive"` for route errors and reroute in navigation.
- **Labels.**
  - Name the map: `aria-label="Map"` on the canvas container, with a visually hidden "N places shown" summary.
  - Category chips: `aria-pressed` is already there. Add the icon with `aria-hidden`.
  - Replace text-glyph buttons (✕) with icons plus `aria-label`. `PointInput` "Clear" and DirectionsCard "Remove waypoint" have only a `title` today.
- **Contrast.** Keep the map label text-on-halo colours from tokens, at ≥ 4.5:1 against the halo. Check the dark accent `#5cb3ee` on `#131a21` (≈ 7.9:1, OK). The night-red text `#ff6b5e` on black is ≈ 7:1.
- **Behaviour.** Respect `prefers-contrast: more` with thicker strokes and no translucent overlays.

**Where in the code.** `App.css`, `index.css`, `ui/*.tsx` (labels), `App.tsx` (the status region).

**Size: S.**

### P9. Onboarding, empty and error states, the start screen. Impact: medium. Effort: S–M (1 day)
- **Start screen (peek).** "Plan a trip" as a primary button that opens directions. "Recent" shows the last 3 places or routes, which `usePlaceSearch` already keeps in history. "My catches" becomes a list row with a count.
- **One-time hint** (dismissable, stored in localStorage): a coach-mark bubble pointing at the map, "Long-press the map to drop a pin · tap a symbol for details".
- **Empty states with an icon, one line and an action:**
  - "No fuel stations within 20 km. Show all on the map".
  - "No route found: the points may be on different water networks. Try moving B to the nearest navigable water", with a button.
- **Errors.** Inline cards with the `err` tokens and a Retry button: GPS denied (and how to enable it), weather failed, data failed to load.
- **Directions card.** Show the nearest town name instead of coordinates. The existing `places` search can find the nearest `place` POI within 3 km of each point; fall back to coordinates.

**Where in the code.** `App.tsx` (`explore` section ~648–665, `routeError`), `ui/CategoryChips.tsx`, `ui/DirectionsCard.tsx`, `ui/PointInput.tsx`.

**Size: S–M.**

### P10. Navigation mode polish. Impact: medium. Effort: S
- **Banner:** the next-event symbol at 34 px (lock, bridge, fuel, using the same glyphs), "Lock in" / "2.1 km" big, and the name plus "then …" on the right (see `mockup-symbols.png`).
- **Data tiles:** show `—` with an `xs` caption ("no GPS fix") rather than a bare dash. Units go in small text.
- **Bottom bar:** "Voice off" becomes an icon toggle (speaker or speaker-off icons). End becomes a labelled red button ("End"), not ✕.
- Offer **Helm (red)** in navigation after sunset.

**Where in the code.** `ui/NavPanel.tsx`, the `App.css` `.nav-*` styles.

**Size: S.**

---

## 4. Recommended icon set

**For the UI, use Lucide (ISC).** It is consistent, open, 24 px with a 2 px round stroke, has every UI icon Interway needs, and has an unusually good set of marine and fishing glyphs. Tabler (MIT, about 5.5k icons, very similar style, with `anchor`, `ship`, `sailboat`, `speedboat`, `kayak`, `lifebuoy`, `fish-hook`, `gas-station`, `building-bridge`) is an equally good fallback. Phosphor (MIT) has fewer marine glyphs. Material Symbols (Apache 2.0) has `anchor`, `sailing` and `phishing`, but no canal lock, slipway or bridge, and its filled geometry clashes with a stroke look.

**For map badges, use the same Lucide glyphs** (white, 2.4 px stroke at 15 px inside a 26 px badge), plus **5 custom glyphs drawn on the same grid**. None of the open sets has a canal lock: Temaki's `lock` is a padlock. Maki (CC0) has `harbor`, `slipway`, `fuel`, `drinking-water`, `toilet`, `danger`, `bridge` and `dam`, and Temaki (CC0) has `boat_ramp`, `fishing_pier` and `fish_cleaning`. Those are solid 15 px map icons and a valid alternative if you prefer filled glyphs, but mixing them with Lucide in the UI would look inconsistent.

| POI | Glyph | Badge | Shape |
|---|---|---|---|
| Marina | Lucide `sailboat` | blue `#1d6fd8` | circle |
| Port / harbour | Lucide `anchor` | navy `#0b3d91` | circle |
| Lock | **custom**: chamber walls and two mitre gates (`M5 2v20 M19 2v20 m5 6 7 3 7-3 m5 15 7 3 7-3`) | amber `#e0a100`, dark glyph | rounded square |
| Bridge | Lucide `bridge` | ochre `#8d6e3f` | rounded square |
| Fuel | Lucide `fuel` | magenta `#c2185b` | circle |
| Drinking water | Lucide `droplet` | cyan `#0288d1` | circle |
| Pump-out | **custom**: U-pipe with a down arrow | violet `#6a4fd6` | circle |
| Toilets / sanitary | Lucide `toilet` | violet `#6a4fd6` | circle |
| Slipway | **custom**: a ramp into waves (Maki `slipway` as an alternative) | green `#2e8b3e` | circle |
| Fishing spot | Lucide `fishing-hook` | teal `#00897b` | circle |
| Tackle shop | Lucide `fishing-rod` | brown `#795548` | circle |
| Fish farm | **custom**: a fish in a dashed net pen | olive `#7a8a12` | rounded square |
| Wreck | **custom**: INT1/OpenSeaMap-style hull line with three masts | red `#c62828` | diamond |
| Obstruction | Lucide `triangle-alert` | red `#c62828` | diamond |
| Town / place | Lucide `building-2` (in search and lists; on the map, a text label only) | slate `#455a64` | circle |
| Cluster | count text | category or blue, with a 6 px soft halo | circle |

The colours follow chart conventions: structures in yellow and ochre, hazards in red, harbours in blue, services in distinct hues. Shape is a second cue for colour-blind users. In helm mode, every badge passes through the red filter.

---

## 5. Suggested order of work

| # | Change | Effort | Why this order |
|---|---|---|---|
| 1 | P5 tokens (including helm-red) + P8 accessibility basics | M + S | Everything else builds on the tokens and button kinds |
| 2 | P1 map symbols + clustering | M | The largest visible improvement; it fixes the dot soup |
| 3 | P2 route summary hierarchy (notices, stat chips, timeline) | M | The core screen; today it is a wall of amber text |
| 4 | P3 sheet physics + map padding | M | Makes the app *feel* native; fixes the half-hidden route |
| 5 | P4 Lucide icon set everywhere | S–M | Consistency; badges reused in chips and lists |
| 6 | P6 place card tabs + fishing day bar + collapsible waterway sheets | M | Progressive disclosure for the long content |
| 7 | P7 motion (draw-in, camera, skeletons, reduced motion) | S–M | Polish once the structure is stable |
| 8 | P9 onboarding / empty / error states + P10 navigation polish | S–M | Finishing touches |

Total: roughly 2–3 weeks for one developer.

## Sources
- [savvy navvy: chart types, including night mode](https://help.savvy-navvy.com/en/article/chart-types-default-night-mode-satellite-and-relief-shading-ob4dze/)
- [Orca: dark mode with a red palette for night vision](https://getorca.com/blog/dark-mode/)
- [Garmin: navigating in the dark (night mode)](https://www.garmin.com/en-CA/blog/?p=31348)
- [MapLibre: line-gradient with line-progress](https://maplibre.org/maplibre-gl-js/docs/examples/line-gradient/)
- [MapLibre: animate a line](https://maplibre.org/maplibre-gl-js/docs/examples/animate-a-line/)
- [Mapbox: cinematic route animations (line-progress reveal)](https://mapbox.com/blog/building-cinematic-route-animations-with-mapboxgl)
- The icon inventories were checked against the published packages: lucide-static 1.77.0, @tabler/icons 3.52.0, @phosphor-icons/core 2.1.1, @mapbox/maki 8.2.0 and @rapideditor/temaki 5.13.0.
