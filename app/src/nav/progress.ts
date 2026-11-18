// Where the boat is on its route: distance along, cross-track error, what comes next, and when it is off the route.
import { bearing, haversine, projectOnSegment, type LngLat } from '../graph/geo';
import type { Stop } from '../routing/itinerary';
import type { Route } from '../routing/router';

export interface Fix {
  lon: number;
  lat: number;
  /** m */
  accuracy: number;
  /** m/s, null when the device does not report it */
  speed: number | null;
  /** degrees, null when the device does not report it */
  heading: number | null;
  /** ms */
  time: number;
}

export const fixOf = (p: GeolocationPosition): Fix => ({
  lon: p.coords.longitude, lat: p.coords.latitude, accuracy: p.coords.accuracy ?? 0,
  speed: p.coords.speed ?? null, heading: p.coords.heading ?? null, time: p.timestamp,
});

export interface Upcoming {
  kind: 'lock' | 'bridge' | 'end';
  name: string;
  /** m from the start of the route */
  at: number;
  /** m from the boat */
  distance: number;
}

export interface Track {
  coords: LngLat[];
  along: number[];
  total: number;
  /** seconds per metre of route, from the planned duration (locks included) */
  secPerM: number;
  /** how far the route's start was snapped from the point asked for (the boat, after a re-route), m */
  startOffset: number;
  events: Omit<Upcoming, 'distance'>[];
}

export interface Progress {
  /** time of the fix, ms */
  time: number;
  along: number;
  /** m off the route line */
  crossTrack: number;
  /** side of the route line the boat is on, seen in the direction of travel */
  side: 'left' | 'right' | null;
  remaining: number;
  /** s to the destination */
  eta: number;
  next: Upcoming | null;
  upcoming: Upcoming[];
  /** fixes in a row off the route */
  offCount: number;
  offRoute: boolean;
  arrived: boolean;
}

export interface Motion {
  /** speed over ground, m/s */
  sog: number | null;
  /** course over ground, degrees */
  cog: number | null;
}

export const OFF_ROUTE_M = 150;
export const OFF_COUNT = 3;
export const ARRIVED_M = 100;
/** the boat is looked for this far behind and ahead of its last position first */
const BACK_M = 2_000;
const AHEAD_M = 10_000;
const SAME_M = 150;
const START_M = 1_000;
/** m/s, about 50 kn */
export const MAX_SOG = 25;
const UPCOMING = 3;

export function buildTrack(route: Route, stops: Stop[]): Track {
  const coords = route.coordinates;
  const along = [0];
  for (let i = 1; i < coords.length; i++) along.push(along[i - 1] + haversine(coords[i - 1][1], coords[i - 1][0], coords[i][1], coords[i][0]));
  const total = along[along.length - 1];
  const events: Track['events'] = stops
    .filter((s) => s.poi.type === 'lock' || s.poi.type === 'bridge')
    .map((s) => ({ kind: s.poi.type as 'lock' | 'bridge', name: s.poi.name, at: s.at }));
  // locks of the graph that no lock POI names
  for (const e of route.events) {
    if (!events.some((x) => x.kind === 'lock' && Math.abs(x.at - e.at) < SAME_M)) events.push({ kind: 'lock', name: e.name, at: e.at });
  }
  events.sort((a, b) => a.at - b.at);
  events.push({ kind: 'end', name: '', at: total });
  return { coords, along, total, secPerM: total > 0 ? route.duration / total : 0, startOffset: route.start.offset, events };
}

/** Nearest point of the track to p among segments i in [lo, hi), at between from and to metres along. */
function project(t: Track, p: LngLat, lo: number, hi: number, from = -Infinity, to = Infinity) {
  const c = t.coords;
  let best = { at: 0, dist: Infinity, side: null as Progress['side'] };
  for (let i = lo; i < hi; i++) {
    const pr = projectOnSegment(p[1], p[0], c[i][1], c[i][0], c[i + 1][1], c[i + 1][0]);
    const at = t.along[i] + (t.along[i + 1] - t.along[i]) * pr.t;
    if (pr.dist < best.dist && at >= from && at <= to) {
      // cross product of the segment direction and the vector to the boat: positive means left of the line
      const cross = (c[i + 1][0] - c[i][0]) * (p[1] - c[i][1]) - (c[i + 1][1] - c[i][1]) * (p[0] - c[i][0]);
      best = { at, dist: pr.dist, side: cross > 0 ? 'left' : cross < 0 ? 'right' : null };
    }
  }
  return best;
}

/** First index whose along is >= m. */
function indexAt(t: Track, m: number): number {
  let lo = 0, hi = t.along.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (t.along[mid] < m) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Distance along the track of the point nearest p (anywhere on it). */
export const alongOf = (t: Track, p: LngLat) => project(t, p, 0, t.coords.length - 1).at;

export function trackProgress(t: Track, fix: Fix, prev: Progress | null, motion: Motion | null = null): Progress {
  const p: LngLat = [fix.lon, fix.lat];
  const n = t.coords.length - 1;
  let best = { at: 0, dist: Infinity, side: null as Progress['side'] };
  if (prev && n > 0) {
    // near where the boat was, so a parallel stretch of the same route (a loop, a way back) does not capture it
    const from = prev.along - BACK_M, to = prev.along + AHEAD_M;
    best = project(t, p, Math.max(0, indexAt(t, from) - 1), Math.min(n, indexAt(t, to) + 1), from, to);
  }
  let limit = Math.max(OFF_ROUTE_M, fix.accuracy);
  if (best.dist > limit && n > 0) best = project(t, p, 0, n);
  // a route planned from the boat starts on the nearest navigable water: being that far off it near the start
  // is expected (a marina basin, a lake the graph does not mesh), not a reason to plan again and again
  if (best.at < t.startOffset + START_M) limit = Math.max(limit, t.startOffset + OFF_ROUTE_M);
  const along = n > 0 ? best.at : 0;
  const crossTrack = n > 0 ? best.dist : haversine(fix.lat, fix.lon, t.coords[0][1], t.coords[0][0]);
  const off = crossTrack > limit;
  const offCount = off ? (prev?.offCount ?? 0) + 1 : 0;
  const remaining = Math.max(0, t.total - along);
  let eta = remaining * t.secPerM;
  // under way, lean on the measured speed: the plan's speed ignores wind, current and the skipper
  if (motion?.sog && motion.sog > 0.5 && t.secPerM > 0) eta = remaining / ((1 / t.secPerM + motion.sog) / 2);
  const upcoming = t.events.filter((e) => e.at > along).slice(0, UPCOMING).map((e) => ({ ...e, distance: e.at - along }));
  return {
    time: fix.time, along, crossTrack, side: off || crossTrack > 10 ? best.side : null, remaining, eta,
    next: upcoming[0] ?? null, upcoming, offCount, offRoute: offCount >= OFF_COUNT, arrived: remaining < ARRIVED_M,
  };
}

/**
 * Speed and course over ground. The device's own values when it reports them; otherwise from the move since
 * `anchor`, an earlier fix far enough away that GPS noise does not dominate (null until then).
 */
export function motionOf(fix: Fix, anchor: Fix | null): Motion {
  const ok = (v: number | null): v is number => v !== null && !Number.isNaN(v);
  let sog = ok(fix.speed) ? fix.speed : null;
  let cog = ok(fix.heading) && (sog === null || sog > 0) ? fix.heading : null;
  if ((sog === null || cog === null) && anchor) {
    const d = haversine(anchor.lat, anchor.lon, fix.lat, fix.lon);
    const dt = (fix.time - anchor.time) / 1000;
    // a jump faster than any boat is a GPS glitch (or a fix after a gap), not a speed
    if (dt > 0 && d >= Math.max(fix.accuracy, anchor.accuracy, 5) && d / dt <= MAX_SOG) {
      sog ??= d / dt;
      cog ??= bearing(anchor.lat, anchor.lon, fix.lat, fix.lon);
    }
  }
  return { sog, cog };
}

/** Whether a new fix should become the anchor for computing motion. */
export const isNewAnchor = (fix: Fix, anchor: Fix | null) =>
  !anchor || haversine(anchor.lat, anchor.lon, fix.lat, fix.lon) >= Math.max(fix.accuracy, anchor.accuracy, 5) * 2
  || fix.time - anchor.time > 30_000;
