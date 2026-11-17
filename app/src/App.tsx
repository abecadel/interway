import { useEffect, useMemo, useRef, useState } from 'react';
import type { LngLat } from './graph/geo';
import { MapView } from './map/MapView';
import type { RoutingApi } from './routing/client';
import { buildItinerary } from './routing/itinerary';
import type { Poi } from './routing/service';
import { ItineraryView } from './ui/ItineraryView';
import { defaultProfile, type Route, type VesselProfile } from './routing/router';
import { fmtDuration, fmtKm, fmtNm, fmtPos, toGpx } from './ui/format';
import { PointInput, type Point } from './ui/PointInput';
import { parseUrlState, writeUrlState } from './ui/urlState';
import { briefMarkdown, buildBrief } from './ui/brief';
import { registerSiteTools, type PlannerBridge } from './agent/siteTools';
import { searchPlaces } from './ui/search';
import './App.css';

const DATA_URL = import.meta.env.VITE_DATA_URL ?? `${import.meta.env.BASE_URL}data/`;
const PROFILE_KEY = 'interway.profile';

const toPoint = (p: LngLat): Point => ({ position: p, label: fmtPos(p) });

function loadProfile(): VesselProfile {
  try {
    return { ...defaultProfile, ...JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') };
  } catch {
    return defaultProfile;
  }
}

export default function App({ client }: { client: RoutingApi }) {
  const [dataStatus, setDataStatus] = useState<string>('Loading waterway data…');
  const [dataReady, setDataReady] = useState(false);
  // The URL wins over stored settings, so a shared (or agent-written) link reproduces the route exactly.
  const [initial] = useState(() => parseUrlState(location.search));
  const [start, setStart] = useState<Point | null>(() => initial.from && toPoint(initial.from));
  const [end, setEnd] = useState<Point | null>(() => initial.to && toPoint(initial.to));
  const [via, setVia] = useState<Point[]>(() => initial.via.map(toPoint));
  const [picking, setPicking] = useState<'start' | 'end' | 'via' | null>(null);
  const [result, setResult] = useState<{ key: string; route: Route | null; error: string | null } | null>(null);
  const [profile, setProfile] = useState<VesselProfile>(() => ({ ...loadProfile(), ...initial.vessel }));
  const viaPositions = useMemo(() => via.map((p) => p.position), [via]);
  const routeKey = JSON.stringify([start?.position, end?.position, viaPositions, profile]);
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [network, setNetwork] = useState<GeoJSON.FeatureCollection | null>(null);
  const [showNetwork, setShowNetwork] = useState(false);
  const [showSeamarks, setShowSeamarks] = useState(true);
  const [pois, setPois] = useState<Poi[]>([]);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    client
      .load(DATA_URL)
      .then(({ manifest, nodes, edges, pois }) => {
        setDataReady(true);
        setPois(pois);
        setDataStatus(`${manifest.region}: ${nodes.toLocaleString()} nodes, ${edges.toLocaleString()} edges`);
      })
      .catch((e) => setDataStatus(e.message));
  }, [client]);

  useEffect(() => localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)), [profile]);

  // Keep the route and vessel in the URL so routes can be shared, bookmarked and edited by AI agents.
  useEffect(() => {
    const s = writeUrlState(location.search, { from: start?.position ?? null, to: end?.position ?? null, via: viaPositions }, profile);
    history.replaceState(null, '', s ? `?${s}` : location.pathname);
  }, [start, end, viaPositions, profile]);

  useEffect(() => {
    if (!showNetwork || network || !dataReady) return;
    client.network().then(setNetwork).catch((e) => setDataStatus(e.message));
  }, [showNetwork, network, dataReady, client]);

  useEffect(() => {
    if (!start || !end || !dataReady) return;
    let cancelled = false;
    client
      .route(start.position, end.position, profile, viaPositions)
      .then((r) => { if (!cancelled) setResult({ key: routeKey, route: r, error: null }); })
      .catch((e) => { if (!cancelled) setResult({ key: routeKey, route: null, error: e.message }); });
    return () => { cancelled = true; };
  }, [start, end, viaPositions, profile, dataReady, client, routeKey]);
  // Only show a result computed for the current inputs.
  const current = start && end && result?.key === routeKey ? result : null;
  const route = current?.route ?? null;
  const routeError = current?.error ?? null;
  const busy = !!start && !!end && dataReady && !current;
  const itinerary = useMemo(() => (route ? buildItinerary(route, pois) : null), [route, pois]);
  const [focus, setFocus] = useState<LngLat | null>(null);

  // AI agents in WebMCP browsers drive the planner through site tools; they see the same state as the UI.
  const latest = useRef({ route, itinerary, profile, viaPositions, start, end, pois });
  useEffect(() => {
    latest.current = { route, itinerary, profile, viaPositions, start, end, pois };
  });
  useEffect(() => {
    if (!dataReady) return;
    const pageLink = (from: LngLat, to: LngLat, via: LngLat[], p: VesselProfile) =>
      `${location.origin}${location.pathname}?${writeUrlState('', { from, to, via }, p)}`;
    const bridge: PlannerBridge = {
      planRoute: async ({ from, to, via, vessel }) => {
        const prof = { ...latest.current.profile, ...vessel };
        const r = await client.route(from, to, prof, via);
        setStart(toPoint(from));
        setEnd(toPoint(to));
        setVia(via.map(toPoint));
        setProfile(prof);
        const it = buildItinerary(r, latest.current.pois);
        return buildBrief({ route: r, itinerary: it, profile: prof, title: `${fmtPos(from)} → ${fmtPos(to)}`, link: pageLink(from, to, via, prof) });
      },
      brief: () => {
        const l = latest.current;
        if (!l.route || !l.itinerary || !l.start || !l.end) return null;
        return buildBrief({
          route: l.route, itinerary: l.itinerary, profile: l.profile, title: `${l.start.label} → ${l.end.label}`,
          link: pageLink(l.start.position, l.end.position, l.viaPositions, l.profile),
        });
      },
      setVessel: (v) => setProfile((p) => ({ ...p, ...v })),
      waypoints: () => latest.current.viaPositions,
      setWaypoints: (v) => setVia(v.map(toPoint)),
      findPlace: (q) => searchPlaces(q),
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

  const setFromMyPosition = (set: (p: Point) => void) => {
    startWatching()
      .then((p) => set({ position: [p.coords.longitude, p.coords.latitude], label: 'My position' }))
      .catch((e) => setGeoError(e.message));
  };

  const onMapClick = (p: LngLat) => {
    const pt = toPoint(p);
    if (picking === 'via') setVia([...via, pt]);
    else if (picking === 'start' || (!picking && !start)) setStart(pt);
    else if (picking === 'end' || !end) setEnd(pt);
    else return;
    setPicking(null);
  };

  const download = (text: string, type: string, name: string) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    a.click();
    URL.revokeObjectURL(a.href);
  };
  const title = () => `${start!.label} → ${end!.label}`;
  const brief = (route: Route) => buildBrief({ route, itinerary: itinerary!, profile, title: title(), link: location.href });
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

  return (
    <div className="app">
      <aside className="panel">
        <h1>Interway</h1>
        <p className="tagline">Inland waterway &amp; coastal route planner</p>

        <PointInput
          label="A" value={start} picking={picking === 'start'} near={near}
          onPick={() => setPicking(picking === 'start' ? null : 'start')}
          onMyPosition={() => setFromMyPosition(setStart)} onSelect={setStart}
        />
        <button className="swap" title="Swap" onClick={() => { setStart(end); setEnd(start); }}>⇅</button>
        <PointInput
          label="B" value={end} picking={picking === 'end'} near={near}
          onPick={() => setPicking(picking === 'end' ? null : 'end')}
          onMyPosition={() => setFromMyPosition(setEnd)} onSelect={setEnd}
        />
        {via.length > 0 && (
          <ol className="via">
            {via.map((p, i) => (
              <li key={i}>
                <span>{p.label}</span>
                <button title="Remove waypoint" onClick={() => setVia(via.filter((_, j) => j !== i))}>✕</button>
              </li>
            ))}
          </ol>
        )}
        <button className={picking === 'via' ? 'active' : ''} onClick={() => setPicking(picking === 'via' ? null : 'via')}>
          {picking === 'via' ? 'Click the map to add a waypoint…' : '+ Add waypoint'}
        </button>
        {geoError && <div className="error small">GPS: {geoError}</div>}

        {busy && <div className="info">Calculating route…</div>}
        {routeError && <div className="error">{routeError}</div>}
        {route && (
          <section className="summary">
            <div className="big">{fmtKm(route.distance)} <span>({fmtNm(route.distance)})</span></div>
            <div>{fmtDuration(route.duration)} at {profile.speedKmh} km/h · {route.locks} locks</div>
            {(route.start.offset > 200 || route.end.offset > 200) && (
              <div className="warn small">
                Start/end snapped to the nearest navigable water ({fmtKm(route.start.offset)} / {fmtKm(route.end.offset)} away).
              </div>
            )}
            {route.unverified > 0 && (
              <div className="warn small">
                Includes {fmtKm(route.unverified)} on unverified connections (short channels or manual links). Check locally before going.
              </div>
            )}
            {route.sea > 0 && (
              <div className="warn small">
                {fmtNm(route.sea)} on open sea: check the weather, tides, traffic schemes and official charts before going.
                {route.shallowest && ` Shallowest stretch allows about ${route.shallowest.draft} m draft (km ${(route.shallowest.at / 1000).toFixed(0)}).`}
                {route.tooShallow > 0 && ` ${(route.tooShallow / 1000).toFixed(0)} km charted shallower than your draft: check charts for a channel.`}
              </div>
            )}
            <ol className="legs">
              {route.legs.map((l, i) => (
                <li key={i}><span>{l.name || 'unnamed waterway'}</span><span>{fmtKm(l.distance)}</span></li>
              ))}
            </ol>
            <ItineraryView itinerary={itinerary!} onSelect={(lon, lat) => setFocus([lon, lat])} />
            <div className="exports">
              <button className="primary" onClick={() => copyBrief(route)}>{copied ? 'Copied ✓' : 'Copy brief for AI'}</button>
              <button onClick={() => download(briefMarkdown(brief(route)), 'text/markdown', 'interway-route.md')}>Brief .md</button>
              <button onClick={() => download(JSON.stringify(brief(route), null, 1), 'application/json', 'interway-route.json')}>JSON</button>
              <button onClick={() => download(toGpx(route, title(), itinerary!.stops), 'application/gpx+xml', 'interway-route.gpx')}>GPX</button>
            </div>
            <p className="small hint">
              Paste the brief into ChatGPT, Claude or another assistant to ask about locks, stops and hazards. It
              contains the route link, which the assistant can change (waypoints, vessel) for you to open.
            </p>
          </section>
        )}

        <details className="profile">
          <summary>Vessel profile</summary>
          <div className="grid">
            {num('speedKmh', 'Speed (km/h)', 0.5)}
            {num('currentMs', 'River current (m/s)')}
            {num('draft', 'Draft (m)')}
            {num('airDraft', 'Air draft (m)')}
            {num('beam', 'Beam (m)')}
            {num('length', 'Length (m)', 0.5)}
            {num('lockPenaltyMin', 'Minutes per lock', 5)}
            <label className="check">
              <input type="checkbox" checked={profile.avoidLocks} onChange={(e) => setProfile({ ...profile, avoidLocks: e.target.checked })} />
              Avoid locks
            </label>
            <label className="check">
              <input type="checkbox" checked={profile.avoidSea} onChange={(e) => setProfile({ ...profile, avoidSea: e.target.checked })} />
              Avoid open sea
            </label>
          </div>
        </details>

        <details className="layers">
          <summary>Layers</summary>
          <label className="check"><input type="checkbox" checked={showSeamarks} onChange={(e) => setShowSeamarks(e.target.checked)} /> OpenSeaMap seamarks</label>
          <label className="check"><input type="checkbox" checked={showNetwork} onChange={(e) => setShowNetwork(e.target.checked)} /> Routable network (debug)</label>
        </details>

        <footer>
          <div className="small">{dataStatus}</div>
          <div className="small disclaimer">Not for navigation. Always use official charts and notices to skippers.</div>
        </footer>
      </aside>
      <MapView
        start={start?.position ?? null}
        end={end?.position ?? null}
        via={viaPositions}
        route={route}
        position={position}
        network={showNetwork ? network : null}
        showSeamarks={showSeamarks}
        pois={pois}
        focus={focus}
        onMapClick={onMapClick}
      />
    </div>
  );
}
