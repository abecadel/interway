// The page URL is the route's public interface: people share it, and AI agents write it to create or change
// a route. ?from=lon,lat&to=lon,lat&via=lon,lat;lon,lat&draft=1.2&air=3&beam=0.5&len=9&speed=10&avoidLocks=1&avoidSea=1
import type { LngLat } from '../graph/geo';
import { defaultProfile, type VesselProfile } from '../routing/router';

export interface UrlState {
  from: LngLat | null;
  to: LngLat | null;
  via: LngLat[];
  vessel: Partial<VesselProfile>;
}

/** URL parameter -> vessel profile field */
export const VESSEL_PARAMS = {
  draft: 'draft',
  air: 'airDraft',
  beam: 'beam',
  len: 'length',
  speed: 'speedKmh',
  current: 'currentMs',
  lockmin: 'lockPenaltyMin',
} as const satisfies Record<string, keyof VesselProfile>;

export function parsePoint(v: string | null | undefined): LngLat | null {
  const parts = v?.split(',').map((x) => Number(x.trim()));
  if (!parts || parts.length !== 2 || parts.some((x) => !Number.isFinite(x))) return null;
  if (Math.abs(parts[0]) > 180 || Math.abs(parts[1]) > 90) return null;
  return [parts[0], parts[1]];
}

export function parseUrlState(search: string): UrlState {
  const q = new URLSearchParams(search);
  const via = (q.get('via') ?? '').split(';').map(parsePoint).filter((p): p is LngLat => p !== null);
  const vessel: Partial<VesselProfile> = {};
  for (const [param, field] of Object.entries(VESSEL_PARAMS)) {
    const raw = q.get(param);
    const n = raw === null || raw.trim() === '' ? NaN : Number(raw);
    if (Number.isFinite(n) && n >= 0) vessel[field] = n;
  }
  for (const flag of ['avoidLocks', 'avoidSea', 'coastal'] as const) {
    const v = q.get(flag);
    if (v !== null) vessel[flag] = v === '1' || v === 'true';
  }
  const date = q.get('date');
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) vessel.departure = date;
  return { from: parsePoint(q.get('from')), to: parsePoint(q.get('to')), via, vessel };
}

const fmt = ([lon, lat]: LngLat) => `${lon.toFixed(5)},${lat.toFixed(5)}`;

/** Query string (without "?") for the route; vessel values are written where they differ from defaults or were
 *  given (an agent's air=3 stays in the link, so the brief does not call it a default). */
export function writeUrlState(search: string, s: Omit<UrlState, 'vessel'>, profile: VesselProfile, entered?: ReadonlySet<string>): string {
  const q = new URLSearchParams(search);
  const set = (k: string, v: string | null) => (v ? q.set(k, v) : q.delete(k));
  set('from', s.from && fmt(s.from));
  set('to', s.to && fmt(s.to));
  set('via', s.via.length ? s.via.map(fmt).join(';') : null);
  for (const [param, field] of Object.entries(VESSEL_PARAMS)) {
    set(param, profile[field] !== defaultProfile[field] || entered?.has(field) ? String(profile[field]) : null);
  }
  set('avoidLocks', profile.avoidLocks ? '1' : null);
  set('avoidSea', profile.avoidSea ? '1' : null);
  set('coastal', profile.coastal ? '1' : null);
  set('date', profile.departure || null);
  return q.toString().replace(/%2C/g, ',').replace(/%3B/g, ';');
}
