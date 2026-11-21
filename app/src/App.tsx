import { useEffect, useMemo, useRef, useState } from 'react';
import { haversine, type LngLat } from './graph/geo';
import { MapView } from './map/MapView';
import type { RoutingApi } from './routing/client';
import { buildItinerary } from './routing/itinerary';
import type { Poi, PoiType } from './routing/service';
import { defaultProfile, type Route, type VesselProfile } from './routing/router';
import { fmtDuration, fmtKm, fmtPos, POI_LABEL, poiDetail, toGpx } from './ui/format';
import type { Point } from './ui/PointInput';
import { parseUrlState, permalink, writeUrlState } from './ui/urlState';
import { makeSnapshot, readSnapshot, snapshotName } from './ui/snapshot';
import { WATERWAYS, type WaterwayInfo } from './routing/waterways';
import { WaterwaysView } from './ui/WaterwaysView';
import { FishingPanel } from './ui/FishingPanel';
import { CatchList } from './ui/CatchList';
import { addCatch, loadCatches, removeCatch } from './ui/catches';
import { FishingRulesView } from './ui/FishingRulesView';
import { countryAt, FISHING } from './routing/fishing';
import { COUNTRY_RULES } from './routing/rules';
import { briefMarkdown, buildBrief } from './ui/brief';
import { registerSiteTools, type PlannerBridge } from './agent/siteTools';
import { type Place, searchPlaces } from './ui/search';
import { buildLocalIndex } from './ui/localSearch';
import { useNavigation } from './nav/useNavigation';
import { NavPanel } from './ui/NavPanel';
import { OfflineMap } from './ui/OfflineMap';
import { download } from './ui/download';
import { trackGpx } from './nav/track';
import type { Stop } from './routing/itinerary';
import type { AltLine, MapFeature } from './map/MapView';
import { CATEGORIES } from './ui/categories';
import { CategoryChips, CategoryList } from './ui/CategoryChips';
import { DirectionsCard } from './ui/DirectionsCard';
import { Icon } from './ui/icons';
import { LayersCard } from './ui/LayersCard';
import { PlaceCard, type PlaceInfo } from './ui/PlaceCard';
import { addRecent, isSaved, loadPlaces, RECENT_KEY, SAVED_KEY, toggleSaved } from './ui/places';
import { RouteSummary } from './ui/RouteSummary';
import { timeDiff } from './ui/routeOptions';
import { SearchBar } from './ui/SearchBar';
import { Sheet } from './ui/Sheet';
import { type Snap, snapHeights } from './ui/sheetSnap';
import { PHONE, useMediaQuery } from './ui/useMediaQuery';
import { useInstallPrompt } from './ui/useInstallPrompt';
import { useTheme } from './ui/useTheme';
import './App.css';
import { loadView } from './map/view';
import { portFacts } from './ui/portFacts';

const DATA_URL = import.meta.env.VITE_DATA_URL ?? `${import.meta.env.BASE_URL}data/`;
const PROFILE_KEY = 'interway.profile';
const SHEET_KEY = 'interway.sheet';
/** the desktop side panel's width with its margin */
const SIDE_PANEL_PX = 424;

const toPoint = (p: LngLat): Point => ({ position: p, label: fmtPos(p) });
const NO_STOPS: Stop[] = [];
const NO_LIMITS: LngLat[] = [];
const NO_ALTS: AltLine[] = [];

// Earlier defaults that older saved profiles carry as if the user had chosen them.
const OLD_DEFAULTS: Partial<VesselProfile> = { beam: 3 };

function loadSaved(): Partial<VesselProfile> {
  try {
    const saved: Partial<VesselProfile> = JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}');
    for (const [k, v] of Object.entries(OLD_DEFAULTS)) if (saved[k as keyof VesselProfile] === v) delete saved[k as keyof VesselProfile];
    return saved;
  } catch {
    return {};
  }
}

function loadSnap(): Snap {
  try {
    const v = localStorage.getItem(SHEET_KEY);
    return v === 'peek' || v === 'full' ? v : 'half';
  } catch {
    return 'half';
  }
}

/** Only what the user changed or gave is saved, so a better default reaches everyone who kept the old one. */
function saveProfile(p: VesselProfile, entered: ReadonlySet<string>) {
  // a trip's departure date is not the boat's: it is not kept for the next visit
  const changed = Object.fromEntries(Object.entries(p).filter(([k, v]) => k !== 'departure' && (defaultProfile[k as keyof VesselProfile] !== v || entered.has(k))));
  localStorage.setItem(PROFILE_KEY, JSON.stringify(changed));
}

export default function App({ client }: { client: RoutingApi }) {
  const [dataStatus, setDataStatus] = useState<string>('Loading waterway data…');
  const [dataReady, setDataReady] = useState(false);
  const [networkError, setNetworkError] = useState<string | null>(null);
  // the data version (its graph's checksum, else its build time): permalinks and snapshots record it
  const [dataId, setDataId] = useState<string | null>(null);
  // The URL wins over stored settings, so a shared (or agent-written) link reproduces the route exactly.
  const [initial] = useState(() => parseUrlState(location.search));
  const [start, setStart] = useState<Point | null>(() => initial.from && toPoint(initial.from));
  const [end, setEnd] = useState<Point | null>(() => initial.to && toPoint(initial.to));
  const [via, setVia] = useState<Point[]>(() => initial.via.map(toPoint));
  const [picking, setPicking] = useState<'start' | 'end' | 'via' | null>(null);
  const [result, setResult] = useState<{ key: string; route: Route | null; error: string | null } | null>(null);
  // a route link (from and to) is the whole route: the boat saved in this browser does not change it
  const [savedBoat] = useState(() => (initial.from && initial.to ? {} : loadSaved()));
  const [linkProfile] = useState<VesselProfile>(() => ({ ...defaultProfile, ...savedBoat, ...initial.vessel }));
  const [profile, setProfile] = useState<VesselProfile>(linkProfile);
  // the vessel fields given (in the link, saved, typed or by an agent), even where equal to the default
  const [entered, setEntered] = useState<ReadonlySet<string>>(() => new Set([...Object.keys(savedBoat), ...Object.keys(initial.vessel)]));
  const prevProfile = useRef(profile);
  useEffect(() => {
    const prev = prevProfile.current;
    prevProfile.current = profile;
    const changed = (Object.keys(profile) as (keyof VesselProfile)[]).filter((k) => profile[k] !== prev[k] && !entered.has(k));
    if (changed.length) setEntered(new Set([...entered, ...changed]));
  }, [profile, entered]);
  const give = (keys: string[]) => setEntered((e) => (keys.every((k) => e.has(k)) ? e : new Set([...e, ...keys])));
  const viaPositions = useMemo(() => via.map((p) => p.position), [via]);
  const routeKey = JSON.stringify([start?.position, end?.position, viaPositions, profile]);
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [network, setNetwork] = useState<GeoJSON.FeatureCollection | null>(null);
  const [showNetwork, setShowNetwork] = useState(false);
  const [showSeamarks, setShowSeamarks] = useState(true);
  const [pois, setPois] = useState<Poi[]>([]);
  const { theme, setTheme, night } = useTheme();
  const install = useInstallPrompt();
  // The map is the screen: a search box (or the directions card) floats on top and a sheet holds the rest, a
  // bottom sheet on phones and a side panel on desktop.
  const phone = useMediaQuery(PHONE);
  const [snap, setSnapState] = useState<Snap>(loadSnap);
  const setSnap = (s: Snap) => {
    setSnapState(s);
    try {
      localStorage.setItem(SHEET_KEY, s);
    } catch {
      // storage blocked: the sheet still moves
    }
  };
  const [place, setPlace] = useState<PlaceInfo | null>(null);
  // a waterway sheet opened by a link (?waterway=id)
  const [waterwaySheet, setWaterwaySheet] = useState<WaterwayInfo | null>(() => WATERWAYS.find((w) => w.id === initial.waterway) ?? null);
  const [category, setCategory] = useState<PoiType | null>(null);
  const [layersOpen, setLayersOpen] = useState(false);
  const [dirOpen, setDirOpen] = useState(false);
  const [customOpen, setCustomOpen] = useState(false);
  // the directions card folds to one line once its route is shown, until the user taps it to edit
  const [editKey, setEditKey] = useState<string | null>(null);
  const [center, setCenter] = useState<LngLat>(() => loadView().center);
  const [recent, setRecent] = useState(() => loadPlaces(RECENT_KEY));
  const [saved, setSaved] = useState(() => loadPlaces(SAVED_KEY));
  // the private catch log (this browser only) and whether its list is open
  const [catches, setCatches] = useState(() => loadCatches());
  const [catchesOpen, setCatchesOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  // phones: the sheet stops below the search box or directions card, whatever their height
  const appRef = useRef<HTMLDivElement>(null);
  const topbarRef = useRef<HTMLDivElement>(null);
  const [topbarH, setTopbarH] = useState(0);
  useEffect(() => {
    const bar = topbarRef.current;
    if (!bar || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      appRef.current!.style.setProperty('--topbar-h', `${bar.offsetHeight}px`);
      setTopbarH(bar.offsetHeight);
    });
    ro.observe(bar);
    return () => ro.disconnect();
  });
  const watchId = useRef<number | null>(null);
  const localIndex = useMemo(() => buildLocalIndex(pois), [pois]);
  const indexRef = useRef(localIndex);
  useEffect(() => {
    indexRef.current = localIndex;
  });

  useEffect(() => {
    client
      .load(DATA_URL)
      .then(({ manifest, nodes, edges, pois }) => {
        setDataId(manifest.sha256?.graph?.slice(0, 12) ?? manifest.built ?? null);
        setDataReady(true);
        setPois(pois);
        setDataStatus(`${manifest.region}: ${nodes.toLocaleString()} nodes, ${edges.toLocaleString()} edges`);
      })
      .catch((e) => setDataStatus(e.message));
  }, [client]);

  // opened from a link, the boat is saved once the user (or an agent) changes something
  useEffect(() => { if (profile !== linkProfile) saveProfile(profile, entered); }, [profile, linkProfile, entered]);

  useEffect(() => {
    if (!showNetwork || network || !dataReady) return;
    client.network().then(setNetwork).catch((e) => setNetworkError(e.message));
  }, [showNetwork, network, dataReady, client]);

  // a route opened from a snapshot is shown as it was saved, until the user changes the trip or recomputes it
  const [frozen, setFrozen] = useState<{ key: string; route: Route; savedAt: string; data: string | null } | null>(null);
  const isFrozen = frozen?.key === routeKey;
  useEffect(() => {
    if (!start || !end || !dataReady || isFrozen) return;
    let cancelled = false;
    client
      .route(start.position, end.position, profile, viaPositions)
      .then((r) => { if (!cancelled) setResult({ key: routeKey, route: r, error: null }); })
      .catch((e) => { if (!cancelled) setResult({ key: routeKey, route: null, error: e.message }); });
    return () => { cancelled = true; };
  }, [start, end, viaPositions, profile, dataReady, client, routeKey, isFrozen]);
  // Only show a result computed for the current inputs.
  const current = isFrozen ? { key: routeKey, route: frozen.route, error: null } : start && end && result?.key === routeKey ? result : null;
  const best = current?.route ?? null;
  // Other routes on offer (not with waypoints: those fix the way), and which one the user chose.
  const [alts, setAlts] = useState<{ key: string; routes: Route[] } | null>(null);
  const [choice, setChoice] = useState<{ key: string; index: number } | null>(null);
  useEffect(() => {
    if (!best || !start || !end || viaPositions.length || isFrozen) return;
    let cancelled = false;
    client
      .alternatives(start.position, end.position, profile)
      .then((r) => { if (!cancelled) setAlts({ key: routeKey, routes: r }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [best, start, end, viaPositions, profile, client, routeKey, isFrozen]);
  const options = useMemo(
    () => (best ? [best, ...(alts?.key === routeKey ? alts.routes : [])] : []),
    [best, alts, routeKey],
  );
  const chosen = choice?.key === routeKey ? Math.min(choice.index, options.length - 1) : 0;
  const route = options[chosen] ?? null;
  const choose = (index: number) => setChoice({ key: routeKey, index });
  const altLines = useMemo(
    () => options.map((r, i) => ({ i, r })).filter(({ i }) => i !== chosen)
      .map(({ i, r }) => ({ index: i, coordinates: r.coordinates, label: timeDiff(r.duration - options[chosen].duration) })),
    [options, chosen],
  );
  const routeError = current?.error ?? null;
  const busy = !!start && !!end && dataReady && !current;
  const itinerary = useMemo(() => (route ? buildItinerary(route, pois) : null), [route, pois]);
  // On a river the way back takes a different time: route it once the route is known.
  const [back, setBack] = useState<{ key: string; duration: number } | null>(null);
  useEffect(() => {
    if (!route || !start || !end || route.downstream + route.upstream === 0) return;
    let cancelled = false;
    client
      .route(end.position, start.position, profile, [...viaPositions].reverse())
      .then((r) => { if (!cancelled) setBack({ key: routeKey, duration: r.duration }); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [route, start, end, viaPositions, profile, client, routeKey]);
  const backDuration = route && back?.key === routeKey && route.downstream + route.upstream > 0 ? back.duration : null;
  const [focus, setFocus] = useState<LngLat | null>(null);
  const limits = useMemo(
    () => [itinerary?.lowestBridge, itinerary?.narrowestLock, itinerary?.shortestLock]
      .filter((s) => s !== undefined)
      .map((s) => [s.poi.lon, s.poi.lat] as LngLat),
    [itinerary],
  );

  // AI agents in WebMCP browsers drive the planner through site tools; they see the same state as the UI.
  const latest = useRef({ route, itinerary, profile, viaPositions, start, end, pois, entered, current });
  // set when an agent changes the vessel or waypoints, cleared once the page has rendered the change
  const changing = useRef(false);
  useEffect(() => {
    latest.current = { route, itinerary, profile, viaPositions, start, end, pois, entered, current };
    changing.current = false;
  });
  useEffect(() => {
    if (!dataReady) return;
    const pageLink = (from: LngLat, to: LngLat, via: LngLat[], p: VesselProfile, e: ReadonlySet<string>) =>
      `${location.origin}${location.pathname}?${writeUrlState('', { from, to, via }, p, e)}`;
    const bridge: PlannerBridge = {
      planRoute: async ({ from, to, via, vessel }) => {
        const prof = { ...latest.current.profile, ...vessel };
        const r = await client.route(from, to, prof, via);
        setStart(toPoint(from));
        setEnd(toPoint(to));
        setVia(via.map(toPoint));
        setProfile(prof);
        const e = new Set([...latest.current.entered, ...Object.keys(vessel)]);
        give(Object.keys(vessel));
        const it = buildItinerary(r, latest.current.pois);
        return buildBrief({ route: r, itinerary: it, profile: prof, title: `${fmtPos(from)} → ${fmtPos(to)}`, link: pageLink(from, to, via, prof, e), entered: e });
      },
      brief: () => {
        const l = latest.current;
        if (changing.current || !l.route || !l.itinerary || !l.start || !l.end) return null;
        return buildBrief({
          route: l.route, itinerary: l.itinerary, profile: l.profile, title: `${l.start.label} → ${l.end.label}`,
          link: pageLink(l.start.position, l.end.position, l.viaPositions, l.profile, l.entered), entered: l.entered,
        });
      },
      routing: () => changing.current || (!!latest.current.start && !!latest.current.end && !latest.current.current),
      error: () => latest.current.current?.error ?? null,
      setVessel: (v) => { changing.current = true; give(Object.keys(v)); setProfile((p) => ({ ...p, ...v })); },
      waypoints: () => latest.current.viaPositions,
      setWaypoints: (v) => { changing.current = true; setVia(v.map(toPoint)); },
      // offline (or nothing found online): the waterway places in the downloaded data
      findPlace: (q) => searchPlaces(q).then(
        (r) => (r.length ? r : indexRef.current.search(q)),
        () => indexRef.current.search(q),
      ),
    };
    void registerSiteTools(bridge);
  }, [dataReady, client]);

  const startWatching = () =>
    new Promise<GeolocationPosition>((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('Geolocation not supported'));
      if (watchId.current !== null && position) return resolve(position);
      let first = true;
      watchId.current = navigator.geolocation.watchPosition(
        (p) => { setPosition(p); setGeoError(null); if (first) { first = false; resolve(p); } },
        (e) => { setGeoError(e.message); if (first) { first = false; reject(e); } },
        { enableHighAccuracy: true, maximumAge: 5000 },
      );
    });

  const nav = useNavigation({
    route, stops: itinerary?.stops ?? NO_STOPS, via: viaPositions, position, startWatching,
    onReroute: (from, ahead) => { setStart({ position: from, label: 'My position' }); setVia(ahead.map(toPoint)); },
  });
  // Keep the route and vessel in the URL so routes can be shared, bookmarked and edited by AI agents. While
  // navigating, re-routes move A to the boat at every turn: the link keeps the planned route.
  useEffect(() => {
    if (nav.active) return;
    const s = writeUrlState(location.search, { from: start?.position ?? null, to: end?.position ?? null, via: viaPositions }, profile, entered);
    history.replaceState(null, '', s ? `?${s}` : location.pathname);
  }, [start, end, viaPositions, profile, entered, nav.active]);
  const underWay = nav.motion?.sog != null && nav.motion.sog > 0.5;
  // the map draws a new route a moment after it arrives: the re-routing note stays up until it shows
  const [drawn, setDrawn] = useState<Route | null>(null);
  const drawing = nav.active && drawn !== null && nav.route !== drawn;

  const setFromMyPosition = (set: (p: Point) => void) => {
    startWatching()
      .then((p) => set({ position: [p.coords.longitude, p.coords.latitude], label: 'My position' }))
      .catch((e) => setGeoError(e.message));
  };

  // directions mode: planning a route (A or B set, or the directions button pressed); else exploring the map
  const directions = dirOpen || !!start || !!end;
  const onMapClick = (p: LngLat) => {
    const pt = toPoint(p);
    if (!picking && !directions) {
      setPlace(null); // a tap on the map closes the place sheet
      return;
    }
    if (picking === 'via') setVia([...via, pt]);
    else if (picking === 'start' || (!picking && !start)) setStart(pt);
    else if (picking === 'end' || !end) setEnd(pt);
    else return;
    setPicking(null);
  };

  const showSheet = () => { if (snap === 'peek') setSnap('half'); };
  const openPlace = (info: PlaceInfo) => {
    setPlace(info);
    setCategory(null);
    showSheet();
  };
  // a place on the route: where along it, and how far off its line
  const onRoute = (pos: LngLat) => {
    const stop = itinerary?.stops.find((s) => Math.abs(s.poi.lon - pos[0]) < 1e-6 && Math.abs(s.poi.lat - pos[1]) < 1e-6);
    return stop ? { at: stop.at, offset: stop.offset } : {};
  };
  const openPoi = (poi: Poi) => {
    const pos: LngLat = [poi.lon, poi.lat];
    openPlace({ label: poi.name || POI_LABEL[poi.type], position: pos, kind: POI_LABEL[poi.type], detail: poiDetail(poi), ...onRoute(pos),
      facts: portFacts(poi) });
    setFocus(pos);
  };
  // a link to a place (?place=lon,lat) opens the nearest harbour, lock or town within 200 m, else a pin there
  const placeOpened = useRef(false);
  useEffect(() => {
    if (!initial.place || !dataReady || placeOpened.current) return;
    placeOpened.current = true;
    const [lon, lat] = initial.place;
    let near: Poi | null = null, best = 200;
    for (const p of pois) {
      const d = haversine(lat, lon, p.lat, p.lon);
      if (d <= best) { best = d; near = p; }
    }
    if (near) openPoi(near);
    else {
      openPlace({ label: fmtPos(initial.place), position: initial.place, kind: 'Dropped pin' });
      setFocus(initial.place);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the data (and its places) is in
  }, [dataReady, pois]);
  const onFeature = (f: MapFeature) => {
    const kind = POI_LABEL[f.type as PoiType];
    const route = onRoute(f.position);
    // the map knows a symbol's name and type only: the full record has the harbour's facts
    const poi = pois.find((p) => p.type === f.type && Math.abs(p.lon - f.position[0]) < 1e-6 && Math.abs(p.lat - f.position[1]) < 1e-6);
    openPlace({ label: f.name || kind, position: f.position, kind, detail: f.detail, ...route, ...(f.at !== undefined ? { at: f.at } : {}),
      ...(poi ? { facts: portFacts(poi) } : {}) });
  };
  const onSearch = (p: Place) => {
    setRecent(addRecent(recent, p));
    // waterway places from the data come as "Schleuse Liepe · lock"
    const [label, kind] = p.label.split(' · ');
    openPlace({ label, position: p.position, ...(kind ? { kind: kind[0].toUpperCase() + kind.slice(1) } : {}) });
    setFocus(p.position);
  };
  const directionsTo = (info: PlaceInfo) => {
    setEnd({ position: info.position, label: info.label });
    // from the boat's position when it is known, as a maps app does
    if (!start && position) setStart({ position: [position.coords.longitude, position.coords.latitude], label: 'My position' });
    setDirOpen(true);
    setPlace(null);
    showSheet();
  };
  const startHere = (info: PlaceInfo) => {
    setStart({ position: info.position, label: info.label });
    setDirOpen(true);
    setPlace(null);
  };
  const closeDirections = () => {
    setStart(null);
    setEnd(null);
    setVia([]);
    setPicking(null);
    setDirOpen(false);
    setCustomOpen(false);
  };
  const locate = () => {
    startWatching()
      .then((p) => setFocus([p.coords.longitude, p.coords.latitude]))
      .catch((e) => setGeoError(e.message));
  };

  // "/" focuses the search box, Esc closes what is open on top of the map
  const escape = useRef<(() => void) | null>(null);
  useEffect(() => {
    escape.current = () => {
      if (layersOpen) setLayersOpen(false);
      else if (place) setPlace(null);
      else if (category) setCategory(null);
    };
  });
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof HTMLElement && /^(INPUT|SELECT|TEXTAREA)$/.test(e.target.tagName);
      if (e.key === '/' && !typing && searchRef.current) {
        e.preventDefault();
        searchRef.current.focus();
      } else if (e.key === 'Escape' && !typing) escape.current!();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const title = () => `${start!.label} → ${end!.label}`;
  const brief = (route: Route) => buildBrief({ route, itinerary: itinerary!, profile, title: title(), link: location.href, entered, data: dataId });
  const base = `${location.origin}${location.pathname}`;
  const routePermalink = (route: Route) => permalink(base, { from: start!.position, to: end!.position, via: viaPositions }, profile, dataId,
    { km: Math.round(route.distance / 100) / 10, locks: route.locks });
  const [linked, setLinked] = useState(false);
  const copyPermalink = (route: Route) => {
    const url = routePermalink(route);
    navigator.clipboard.writeText(url).then(() => { setLinked(true); setTimeout(() => setLinked(false), 2000); }, () => prompt('Permalink', url));
  };
  const saveSnapshot = (route: Route) => {
    const s = makeSnapshot({ data: dataId, link: routePermalink(route), from: start!.position, to: end!.position, via: viaPositions, profile,
      entered: [...entered], route, brief: brief(route) });
    download(JSON.stringify(s), 'application/json', snapshotName(s));
  };
  const [snapshotError, setSnapshotError] = useState<string | null>(null);
  const openSnapshot = (file: File) => {
    file.text().then((text) => {
      const s = readSnapshot(text);
      const st = toPoint(s.from), en = toPoint(s.to), vi = s.via.map(toPoint);
      setStart(st);
      setEnd(en);
      setVia(vi);
      setProfile(s.profile);
      setEntered(new Set(s.entered));
      setFrozen({ key: JSON.stringify([s.from, s.to, s.via, s.profile]), route: s.route, savedAt: s.savedAt, data: s.data });
      setSnapshotError(null);
      setDirOpen(true);
      setPlace(null);
    }).catch((e: Error) => setSnapshotError(e.message));
  };
  const snapshotInput = (
    <label className="button file">
      Open snapshot
      <input type="file" accept="application/json,.json" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) openSnapshot(f); e.target.value = ''; }} />
    </label>
  );
  // a permalink opened on newer data: what was planned then and what the route is now
  const planned = initial.planned;
  const plannedKey = useRef(routeKey);
  const changed = planned && route && routeKey === plannedKey.current && !isFrozen ? [
    planned.data && dataId && planned.data !== dataId && 'the waterway data has been updated since',
    planned.km !== null && Math.abs(planned.km - route.distance / 1000) >= 0.5 && `distance ${planned.km} km then, ${Math.round(route.distance / 100) / 10} km now`,
    planned.locks !== null && planned.locks !== route.locks && `${planned.locks} locks then, ${route.locks} now`,
  ].filter(Boolean) : [];
  const [copied, setCopied] = useState(false);
  const copyBrief = (route: Route) => {
    const md = briefMarkdown(brief(route));
    navigator.clipboard.writeText(md).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
      () => download(md, 'text/markdown', 'interway-route.md'),
    );
  };

  const num = (key: keyof VesselProfile, label: string, step = 0.1) => (
    <label>
      {label}
      <input
        type="number" step={step} min={0} value={profile[key] as number}
        onChange={(e) => setProfile({ ...profile, [key]: Number(e.target.value) })}
      />
    </label>
  );
  const near = position ? ([position.coords.longitude, position.coords.latitude] as LngLat) : undefined;

  // what covers the map: on phones the search box and the sheet (at most half the screen is kept clear for it),
  // on desktop the side panel when open
  const insets = useMemo(() => {
    if (!phone) return { top: 0, bottom: 0, left: snap === 'peek' ? 0 : SIDE_PANEL_PX };
    const h = snapHeights(window.innerHeight);
    return { top: topbarH, bottom: Math.min(h[snap], h.half), left: 0 };
  }, [phone, snap, topbarH]);

  const sheetTitle = route && directions
    ? `${fmtDuration(route.duration)} · ${fmtKm(route.distance)}`
    : place ? place.label : category ? CATEGORIES.find(([t]) => t === category)![1] : directions ? 'Directions' : 'Explore';

  const top = directions ? (
    <DirectionsCard
      start={start} end={end} via={via} picking={picking} near={near} local={localIndex} profile={profile} customOpen={customOpen}
      setStart={setStart} setEnd={setEnd} setVia={setVia} setPicking={setPicking} myPosition={setFromMyPosition}
      setProfile={setProfile} onCustom={() => { setCustomOpen(!customOpen); showSheet(); }} onClose={closeDirections}
      compact={phone && !!route && !!start && !!end && editKey !== routeKey && !customOpen && picking === null} onEdit={() => setEditKey(routeKey)}
    />
  ) : (
    <div className="explore-top">
      <SearchBar
        near={near ?? center} local={localIndex} recent={recent} saved={saved} inputRef={searchRef}
        onSelect={onSearch} onDirections={() => { setDirOpen(true); setPlace(null); }}
      />
      <CategoryChips active={category} onSelect={(t) => { setCategory(t); setPlace(null); if (t) showSheet(); }} />
    </div>
  );

  const track = !nav.active && nav.track.length > 1 && (
    <div className="track small">
      Track: {nav.track.length} points{' '}
      <button onClick={() => download(trackGpx(nav.track), 'application/gpx+xml', 'interway-track.gpx')}>Export GPX</button>{' '}
      <button onClick={nav.clearTrack}>Clear</button>
    </div>
  );

  // the fishing rules of the country a place is in (from the nearest town), for today
  const fishingHere = (pos: LngLat) => {
    const cc = countryAt(pos, pois);
    const rules = cc ? FISHING[cc] : undefined;
    return rules && <FishingRulesView rules={rules} country={COUNTRY_RULES.find((r) => r.cc === cc)!.name} day={new Date().toISOString().slice(0, 10)} />;
  };
  const body = catchesOpen ? (
    <CatchList
      catches={catches} onRemove={(id) => setCatches(removeCatch(catches, id))} onClose={() => setCatchesOpen(false)} download={download}
      onOpen={(c) => { setCatchesOpen(false); openPlace({ label: c.species, position: c.position, kind: 'My catch', detail: new Date(c.time).toLocaleString() }); setFocus(c.position); }}
    />
  ) : waterwaySheet ? (
    <section className="place-card" aria-label={waterwaySheet.name}>
      <div className="waterway-head">
        <strong>{waterwaySheet.name}</strong>
        <button className="round" aria-label="Close" onClick={() => setWaterwaySheet(null)}>✕</button>
      </div>
      <WaterwaysView waterways={[waterwaySheet]} />
    </section>
  ) : place ? (
    <PlaceCard
      place={place} saved={isSaved(saved, place)} onClose={() => setPlace(null)}
      onDirections={() => directionsTo(place)} onFrom={() => startHere(place)}
      onToggleSave={() => setSaved(toggleSaved(saved, { label: place.label, position: place.position }))}
    >
      <details className="more">
        <summary>Fishing here</summary>
        <FishingPanel position={place.position} label={place.label} onLog={(c) => setCatches(addCatch(catches, c))} rules={fishingHere(place.position)} />
      </details>
    </PlaceCard>
  ) : category ? (
    <CategoryList pois={pois} type={category} center={near ?? center} onSelect={openPoi} onClose={() => setCategory(null)} />
  ) : directions ? (
    <>
      {busy && (
        <div className="skeleton" role="status" aria-label="Calculating route…">
          <div className="bone big" /><div className="bone" /><div className="bone short" />
          <div className="bones"><div className="bone chip" /><div className="bone chip" /><div className="bone chip" /></div>
        </div>
      )}
      {isFrozen && (
        <div className="info small">
          Snapshot saved {frozen.savedAt.slice(0, 10)}: shown as it was planned, not recomputed.{' '}
          <button onClick={() => setFrozen(null)}>Recompute on today's data</button>
        </div>
      )}
      {changed.length > 0 && <div className="warn small">This permalink was planned on earlier data: {changed.join('; ')}.</div>}
      {snapshotError && <div className="error small">{snapshotError}</div>}
      {routeError && <div className="error" role="alert">{routeError}</div>}
      {!start && !end && <p className="info small">Choose a start and a destination: search, use your position, or tap the map. {snapshotInput}</p>}
      {route && (
        <RouteSummary
          route={route} itinerary={itinerary!} profile={profile} back={backDuration} onStart={nav.start}
          options={options} chosen={chosen} onChoose={choose}
          onStepsOpen={() => setSnap('full')} onFocus={(lon, lat) => setFocus([lon, lat])}
          more={(
            <>
              <OfflineMap line={route.coordinates} />
              <div className="exports">
                <button className="primary" onClick={() => copyBrief(route)}>{copied ? 'Copied ✓' : 'Copy brief for AI'}</button>
                <button onClick={() => download(briefMarkdown(brief(route)), 'text/markdown', 'interway-route.md')}>Brief .md</button>
                <button onClick={() => download(JSON.stringify(brief(route), null, 1), 'application/json', 'interway-route.json')}>JSON</button>
                <button onClick={() => download(toGpx(route, title(), itinerary!.stops), 'application/gpx+xml', 'interway-route.gpx')}>GPX</button>
              </div>
              <div className="exports">
                <button onClick={() => copyPermalink(route)}>{linked ? 'Copied ✓' : 'Copy permalink'}</button>
                <button onClick={() => saveSnapshot(route)}>Save snapshot</button>
                {snapshotInput}
              </div>
              <p className="small hint">
                A permalink keeps every setting and the data version: opened later it says if the route has changed.
                A snapshot is the exact route and brief in a file, shown unchanged when you open it again.
              </p>
              <p className="small hint">
                Paste the brief into ChatGPT, Claude or another assistant to ask about locks, stops and hazards. It
                contains the route link, which the assistant can change (waypoints, vessel) for you to open.
              </p>
            </>
          )}
        />
      )}
      {nav.error && <div className="error small">Navigation: {nav.error}</div>}
      {customOpen && (
        <section className="profile" aria-label="Vessel profile">
          <h3>Your boat</h3>
          <div className="grid">
            {num('speedKmh', 'Speed (km/h)', 0.5)}
            {num('currentMs', 'River current (m/s)')}
            {num('draft', 'Draft (m)')}
            {num('airDraft', 'Air draft (m)')}
            {num('beam', 'Beam (m)')}
            {num('length', 'Length (m)', 0.5)}
            {num('lockPenaltyMin', 'Minutes per lock', 5)}
            <label>
              Departure date
              <input type="date" value={profile.departure} onChange={(e) => setProfile({ ...profile, departure: e.target.value })} />
            </label>
            <label className="check">
              <input type="checkbox" checked={profile.avoidLocks} onChange={(e) => setProfile({ ...profile, avoidLocks: e.target.checked })} />
              Avoid locks
            </label>
            <label className="check">
              <input type="checkbox" checked={profile.avoidSea} onChange={(e) => setProfile({ ...profile, avoidSea: e.target.checked })} />
              Avoid open sea
            </label>
            <label className="check">
              <input type="checkbox" checked={profile.coastal} onChange={(e) => setProfile({ ...profile, coastal: e.target.checked })} />
              Stay near the coast (harbour to harbour)
            </label>
          </div>
        </section>
      )}
      {track}
    </>
  ) : (
    <section className="explore">
      <h1>Interway</h1>
      <p className="tagline">Inland waterway &amp; coastal route planner</p>
      <p className="small muted">Search a place, pick a category, or long-press the map (right-click on a computer) to drop a pin.</p>
      <p className="small">{snapshotInput}</p>
      <p className="small"><button type="button" onClick={() => setCatchesOpen(true)}>My catches ({catches.length})</button></p>
      {snapshotError && <div className="error small">{snapshotError}</div>}
      {track}
    </section>
  );

  // what a screen reader hears when the route changes: computing, then the result in one line
  const announcement = busy ? 'Calculating route' : route ? `Route: ${fmtDuration(route.duration)}, ${fmtKm(route.distance)}, ${route.locks} locks` : '';
  const footer = (
    <footer>
      <div className="visually-hidden" aria-live="polite">{announcement}</div>
      {geoError && <div className="error small">GPS: {geoError}</div>}
      {/* loading or failing is news; once loaded, what is loaded is in Layers */}
      {!dataReady && <div className="small" role="status">{dataStatus}</div>}
      {networkError && <div className="error small" role="alert">{networkError}</div>}
      <div className="small disclaimer">Not for navigation. Always use official charts and notices to skippers.</div>
      {install && <button type="button" className="install" onClick={install}>Install app</button>}
    </footer>
  );
  const locateButton = (
    <button type="button" className="fab" aria-label="Show my position" title="Show my position" onClick={locate}>
      <Icon name="myLocation" size={22} />
    </button>
  );

  return (
    <div ref={appRef} className={nav.active ? 'app navigating' : 'app'}>
      <MapView
        start={start?.position ?? null}
        end={end?.position ?? null}
        via={viaPositions}
        route={directions ? nav.route : null}
        onRouteDrawn={setDrawn}
        insets={insets}
        position={position}
        network={showNetwork ? network : null}
        showSeamarks={showSeamarks}
        pois={pois}
        focus={focus}
        onMapClick={onMapClick}
        follow={nav.active && nav.follow}
        course={underWay ? nav.motion!.cog : null}
        onUserMove={() => nav.setFollow(false)}
        fitRoute={!nav.active}
        limits={directions ? limits : NO_LIMITS}
        picking={picking !== null || (directions && (!start || !end))}
        night={night}
        onFeatureClick={onFeature}
        onLongPress={(p) => openPlace({ label: 'Dropped pin', position: p })}
        onViewChange={setCenter}
        place={place?.position ?? null}
        alternatives={directions && !nav.active ? altLines : NO_ALTS}
        onAlternative={(i) => choose(altLines[i].index)}
      />
      {nav.active ? (
        <NavPanel nav={drawing ? { ...nav, rerouting: true } : nav} />
      ) : (
        <>
          {phone && <div ref={topbarRef} className="topbar">{top}</div>}
          <div className="map-tools">
            <button type="button" className="fab" aria-label="Layers" title="Layers" aria-expanded={layersOpen} onClick={() => setLayersOpen(!layersOpen)}>
              <Icon name="layers" size={22} />
            </button>
            {!phone && locateButton}
          </div>
          {layersOpen && (
            <div className="layers-pop">
              <LayersCard
                theme={theme} setTheme={setTheme} seamarks={showSeamarks} setSeamarks={setShowSeamarks}
                network={showNetwork} setNetwork={setShowNetwork} onClose={() => setLayersOpen(false)} about={dataReady ? dataStatus : undefined}
              />
            </div>
          )}
          <Sheet phone={phone} snap={snap} onSnap={setSnap} title={sheetTitle} top={phone ? undefined : top} fab={phone ? locateButton : undefined}>
            {body}
            {footer}
          </Sheet>
        </>
      )}
    </div>
  );
}
