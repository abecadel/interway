// The track sailed while navigating: kept across reloads, exported as GPX.
import { haversine } from '../graph/geo';
import type { Fix } from './progress';

export interface TrackPoint {
  lon: number;
  lat: number;
  /** ms */
  time: number;
}

export const TRACK_KEY = 'interway.track';
export const MIN_STEP_M = 10;
export const MAX_POINTS = 20_000;

/** The track with this fix added if the boat has moved far enough (a new array), or the same track. */
export function addFix(track: TrackPoint[], fix: Fix): TrackPoint[] {
  const last = track[track.length - 1];
  if (last && haversine(last.lat, last.lon, fix.lat, fix.lon) < Math.max(MIN_STEP_M, fix.accuracy / 2)) return track;
  const next = [...track, { lon: fix.lon, lat: fix.lat, time: fix.time }];
  return next.length > MAX_POINTS ? next.slice(next.length - MAX_POINTS) : next;
}

export function loadTrack(): TrackPoint[] {
  try {
    const t = JSON.parse(localStorage.getItem(TRACK_KEY) ?? '[]');
    return Array.isArray(t) ? t : [];
  } catch {
    return [];
  }
}

export function saveTrack(track: TrackPoint[]) {
  try {
    if (track.length) localStorage.setItem(TRACK_KEY, JSON.stringify(track));
    else localStorage.removeItem(TRACK_KEY);
  } catch {
    // storage full or blocked: the track lives on in memory until the page closes
  }
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;');

export function trackGpx(track: TrackPoint[], name = 'Interway track'): string {
  const pts = track
    .map((p) => `      <trkpt lat="${p.lat.toFixed(6)}" lon="${p.lon.toFixed(6)}"><time>${new Date(p.time).toISOString()}</time></trkpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Interway" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
}
