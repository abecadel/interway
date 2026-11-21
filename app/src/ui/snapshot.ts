// A frozen route: the exact route and brief saved to a file, reopened later unchanged, whatever the data says then.
import type { LngLat } from '../graph/geo';
import type { Route, VesselProfile } from '../routing/router';
import type { RouteBrief } from './brief';

export interface Snapshot {
  interway: 'route-snapshot';
  version: 1;
  /** when it was saved (ISO time) */
  savedAt: string;
  /** the data version the route was computed on */
  data: string | null;
  link: string;
  from: LngLat;
  to: LngLat;
  via: LngLat[];
  profile: VesselProfile;
  /** vessel fields the user gave */
  entered: string[];
  route: Route;
  brief: RouteBrief;
}

export function makeSnapshot(s: Omit<Snapshot, 'interway' | 'version' | 'savedAt'>, now = new Date()): Snapshot {
  return { interway: 'route-snapshot', version: 1, savedAt: now.toISOString(), ...s };
}

const isPoint = (p: unknown): p is LngLat => Array.isArray(p) && p.length === 2 && p.every((x) => typeof x === 'number' && Number.isFinite(x));

/** Reads a saved snapshot file, or says why it is not one. */
export function readSnapshot(text: string): Snapshot {
  let v: Partial<Snapshot>;
  try {
    v = JSON.parse(text);
  } catch {
    throw new Error('Not a route snapshot: the file is not JSON');
  }
  if (v?.interway !== 'route-snapshot') throw new Error('Not a route snapshot from Interway');
  if (v.version !== 1) throw new Error(`Route snapshot version ${String(v.version)} is not supported`);
  if (!isPoint(v.from) || !isPoint(v.to) || !Array.isArray(v.via) || !v.via.every(isPoint) || !v.route || !Array.isArray(v.route.coordinates)
    || !v.profile || !v.brief) {
    throw new Error('Route snapshot is incomplete');
  }
  return v as Snapshot;
}

const FOLD: Record<string, string> = { ł: 'l', Ł: 'L', ø: 'o', Ø: 'O', ß: 'ss', đ: 'd', Đ: 'D' };

/** File name for a snapshot: interway-<title>-<date>.json */
export function snapshotName(s: Snapshot): string {
  const plain = s.brief.title.replace(/[łŁøØßđĐ]/g, (c) => FOLD[c]).normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const title = plain.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').toLowerCase().slice(0, 60) || 'route';
  return `interway-${title}-${s.savedAt.slice(0, 10)}.json`;
}
