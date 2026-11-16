import { useEffect, useMemo, useRef, useState } from 'react';
import type { LngLat } from './graph/geo';
import { MapView } from './map/MapView';
import { RoutingClient } from './routing/client';
import { defaultProfile, type Route, type VesselProfile } from './routing/router';
import { fmtDuration, fmtKm, fmtNm, fmtPos, toGpx } from './ui/format';
import { searchPlaces, type Place } from './ui/search';
import './App.css';

const DATA_URL = import.meta.env.VITE_DATA_URL ?? `${import.meta.env.BASE_URL}data/`;
const PROFILE_KEY = 'interway.profile';

interface Point {
  position: LngLat;
  label: string;
}

function pointFromUrl(key: 'from' | 'to'): Point | null {
  const v = new URLSearchParams(location.search).get(key);
  const parts = v?.split(',').map(Number);
  if (!parts || parts.length !== 2 || parts.some((x) => !Number.isFinite(x))) return null;
  const p: LngLat = [parts[0], parts[1]];
  return { position: p, label: fmtPos(p) };
}

function loadProfile(): VesselProfile {
  try {
    return { ...defaultProfile, ...JSON.parse(localStorage.getItem(PROFILE_KEY) ?? '{}') };
  } catch {
    return defaultProfile;
  }
}

function PointInput(props: {
  label: string;
  value: Point | null;
  picking: boolean;
  near?: LngLat;
  onPick: () => void;
  onMyPosition: () => void;
  onSelect: (p: Point | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 3) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchPlaces(query, props.near, ctrl.signal)
        .then((r) => { setResults(r); setError(null); })
        .catch((e) => { if (!ctrl.signal.aborted) setError(e.message); });
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query, props.near]);

  return (
    <div className="point-input">
      <div className="point-row">
        <span className="point-label">{props.label}</span>
        <input
          placeholder={props.value ? props.value.label : 'Search place or click the map'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {props.value && <button title="Clear" onClick={() => props.onSelect(null)}>✕</button>}
      </div>
      <div className="point-actions">
        <button onClick={props.onMyPosition}>My position</button>
        <button className={props.picking ? 'active' : ''} onClick={props.onPick}>
          {props.picking ? 'Click on the map…' : 'Pick on map'}
        </button>
      </div>
      {error && <div className="error small">{error}</div>}
      {query.trim().length >= 3 && results.length > 0 && (
        <ul className="results">
          {results.map((r, i) => (
            <li key={i}>
              <button onClick={() => { props.onSelect({ position: r.position, label: r.label }); setQuery(''); setResults([]); }}>
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default function App() {
  const client = useMemo(() => new RoutingClient(), []);
  const [dataStatus, setDataStatus] = useState<string>('Loading waterway data…');
  const [dataReady, setDataReady] = useState(false);
  const [start, setStart] = useState<Point | null>(() => pointFromUrl('from'));
  const [end, setEnd] = useState<Point | null>(() => pointFromUrl('to'));
  const [picking, setPicking] = useState<'start' | 'end' | null>(null);
  const [result, setResult] = useState<{ key: string; route: Route | null; error: string | null } | null>(null);
  const [profile, setProfile] = useState<VesselProfile>(loadProfile);
  const routeKey = JSON.stringify([start?.position, end?.position, profile]);
  const [position, setPosition] = useState<GeolocationPosition | null>(null);
  const [geoError, setGeoError] = useState<string | null>(null);
  const [network, setNetwork] = useState<GeoJSON.FeatureCollection | null>(null);
  const [showNetwork, setShowNetwork] = useState(false);
  const [showSeamarks, setShowSeamarks] = useState(true);
  const watchId = useRef<number | null>(null);

  useEffect(() => {
    client
      .load(DATA_URL)
      .then(({ manifest, nodes, edges }) => {
        setDataReady(true);
        setDataStatus(`${manifest.region}: ${nodes.toLocaleString()} nodes, ${edges.toLocaleString()} edges`);
      })
      .catch((e) => setDataStatus(e.message));
  }, [client]);

  useEffect(() => localStorage.setItem(PROFILE_KEY, JSON.stringify(profile)), [profile]);

  // Keep A/B in the URL so routes can be shared and bookmarked.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const fmt = (p: Point | null) => p && `${p.position[0].toFixed(5)},${p.position[1].toFixed(5)}`;
    for (const [k, p] of [['from', start], ['to', end]] as const) {
      const v = fmt(p);
      if (v) q.set(k, v);
      else q.delete(k);
    }
    const s = q.toString();
    history.replaceState(null, '', s ? `?${s}` : location.pathname);
  }, [start, end]);

  useEffect(() => {
    if (!showNetwork || network || !dataReady) return;
    client.network().then(setNetwork).catch((e) => setDataStatus(e.message));
  }, [showNetwork, network, dataReady, client]);

  useEffect(() => {
    if (!start || !end || !dataReady) return;
    let cancelled = false;
    client
      .route(start.position, end.position, profile)
      .then((r) => { if (!cancelled) setResult({ key: routeKey, route: r, error: null }); })
      .catch((e) => { if (!cancelled) setResult({ key: routeKey, route: null, error: e.message }); });
    return () => { cancelled = true; };
  }, [start, end, profile, dataReady, client, routeKey]);
  // Only show a result computed for the current inputs.
  const current = start && end && result?.key === routeKey ? result : null;
  const route = current?.route ?? null;
  const routeError = current?.error ?? null;
  const busy = !!start && !!end && dataReady && !current;

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
    const pt = { position: p, label: fmtPos(p) };
    if (picking === 'start' || (!picking && !start)) setStart(pt);
    else if (picking === 'end' || !end) setEnd(pt);
    else return;
    setPicking(null);
  };

  const downloadGpx = () => {
    if (!route) return;
    const blob = new Blob([toGpx(route, `${start?.label} → ${end?.label}`)], { type: 'application/gpx+xml' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'interway-route.gpx';
    a.click();
    URL.revokeObjectURL(a.href);
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
            <ol className="legs">
              {route.legs.map((l, i) => (
                <li key={i}><span>{l.name || 'unnamed waterway'}</span><span>{fmtKm(l.distance)}</span></li>
              ))}
            </ol>
            <button onClick={downloadGpx}>Export GPX</button>
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
        route={route}
        position={position}
        network={showNetwork ? network : null}
        showSeamarks={showSeamarks}
        onMapClick={onMapClick}
      />
    </div>
  );
}
