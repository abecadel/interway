// Navigation mode: progress along the route at every GPS fix, the screen kept on, re-routing when off the route.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { LngLat } from '../graph/geo';
import type { Stop } from '../routing/itinerary';
import type { Route } from '../routing/router';
import { announce, dueAlerts } from './alerts';
import { addFix, loadTrack, saveTrack, type TrackPoint } from './track';
import { alongOf, buildTrack, fixOf, isNewAnchor, motionOf, trackProgress, type Fix, type Motion, type Progress, type Track } from './progress';

/** at most one automatic re-route this often */
export const REROUTE_MS = 30_000;
export const VOICE_KEY = 'interway.voice';
/** the track is written to storage every this many new points (and when navigation stops) */
const SAVE_EVERY = 10;

export interface NavigationOptions {
  route: Route | null;
  stops: Stop[];
  via: LngLat[];
  position: GeolocationPosition | null;
  /** starts GPS updates (resolves with the first fix) */
  startWatching: () => Promise<GeolocationPosition>;
  /** plan again from the boat, through the waypoints still ahead */
  onReroute: (from: LngLat, via: LngLat[]) => void;
}

export interface Navigation {
  active: boolean;
  follow: boolean;
  progress: Progress | null;
  motion: Motion | null;
  rerouting: boolean;
  /** the route to draw: while navigating, the last one stays until a re-route from the boat replaces it */
  route: Route | null;
  error: string | null;
  start: () => void;
  stop: () => void;
  setFollow: (f: boolean) => void;
  /** speak warnings (vibration is always on) */
  voice: boolean;
  setVoice: (v: boolean) => void;
  /** the track sailed, kept across reloads until cleared */
  track: TrackPoint[];
  clearTrack: () => void;
}

function loadVoice() {
  try {
    return localStorage.getItem(VOICE_KEY) === '1';
  } catch {
    return false;
  }
}

export function useNavigation({ route, stops, via, position, startWatching, onReroute }: NavigationOptions): Navigation {
  const [active, setActive] = useState(false);
  const [follow, setFollow] = useState(true);
  const [progress, setProgress] = useState<Progress | null>(null);
  const [motion, setMotion] = useState<Motion | null>(null);
  // the route a re-route was asked from: once a new route arrives, re-routing is over
  const [reroutedFrom, setReroutedFrom] = useState<Route | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [voice, setVoiceState] = useState(loadVoice);
  const [track, setTrack] = useState<TrackPoint[]>(loadTrack);
  const alerted = useRef(new Set<string>());
  const trackRef = useRef(track);
  const unsaved = useRef(0);
  // the app drops the old route as soon as a re-route moves A to the boat: keep following it until the new one arrives
  const [held, setHeld] = useState<{ route: Route; stops: Stop[] } | null>(null);
  if (route && held?.route !== route) setHeld({ route, stops });
  const shown = route ?? (active ? held?.route ?? null : null);
  const shownStops = route || !held ? stops : held.stops;
  const line = useMemo(() => (shown ? buildTrack(shown, shownStops) : null), [shown, shownStops]);
  const prev = useRef<Progress | null>(null);
  const prevTrack = useRef<Track | null>(null);
  const anchor = useRef<Fix | null>(null);
  const lastReroute = useRef(-Infinity);
  const latest = useRef({ via, onReroute, voice });
  useEffect(() => {
    latest.current = { via, onReroute, voice };
  });

  useEffect(() => {
    if (!active || !position || !line) return;
    // a new route (re-planned from the boat) starts the progress afresh
    if (prevTrack.current !== line) prev.current = null;
    prevTrack.current = line;
    const fix = fixOf(position);
    const m = motionOf(fix, anchor.current);
    if (isNewAnchor(fix, anchor.current)) anchor.current = fix;
    const p = trackProgress(line, fix, prev.current, m);
    prev.current = p;
    setProgress(p);
    setMotion(m);
    for (const a of dueAlerts(p, alerted.current)) announce(a, latest.current.voice);
    const next = addFix(trackRef.current, fix);
    if (next !== trackRef.current) {
      trackRef.current = next;
      setTrack(next);
      if (++unsaved.current >= SAVE_EVERY) {
        unsaved.current = 0;
        saveTrack(next);
      }
    }
    if (p.offRoute && !p.arrived && fix.time - lastReroute.current >= REROUTE_MS) {
      lastReroute.current = fix.time;
      setReroutedFrom(shown);
      const ahead = latest.current.via.filter((v) => alongOf(line, v) > p.along);
      latest.current.onReroute([fix.lon, fix.lat], ahead);
    }
  }, [active, position, line, shown]);

  // keep the screen on while navigating; the browser drops the lock when the page is hidden
  useEffect(() => {
    if (!active || !navigator.wakeLock) return;
    let lock: WakeLockSentinel | null = null;
    let done = false;
    const acquire = () => {
      if (document.visibilityState !== 'visible') return;
      navigator.wakeLock.request('screen').then(
        (l) => { if (done) void l.release(); else lock = l; },
        () => {}, // not allowed (battery saver, no user gesture): navigation works without it
      );
    };
    acquire();
    document.addEventListener('visibilitychange', acquire);
    return () => {
      done = true;
      document.removeEventListener('visibilitychange', acquire);
      void lock?.release();
    };
  }, [active]);

  const start = useCallback(() => {
    setError(null);
    setFollow(true);
    setActive(true);
    prev.current = null;
    anchor.current = null;
    lastReroute.current = -Infinity;
    alerted.current = new Set();
    startWatching().catch((e: Error) => { setError(e.message); setActive(false); });
  }, [startWatching]);

  const stop = useCallback(() => {
    saveTrack(trackRef.current);
    unsaved.current = 0;
    setActive(false);
    setProgress(null);
    setMotion(null);
    setReroutedFrom(null);
  }, []);

  const setVoice = useCallback((v: boolean) => {
    setVoiceState(v);
    try {
      localStorage.setItem(VOICE_KEY, v ? '1' : '0');
    } catch {
      // not remembered, still on for now
    }
  }, []);

  const clearTrack = useCallback(() => {
    trackRef.current = [];
    unsaved.current = 0;
    setTrack([]);
    saveTrack([]);
  }, []);

  const rerouting = active && reroutedFrom !== null && reroutedFrom === shown;
  return { active, follow, progress, motion, rerouting, route: shown, error, start, stop, setFollow, voice, setVoice, track, clearTrack };
}
