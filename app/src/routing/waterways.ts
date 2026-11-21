// Researched information about the waterways routes use: navigability, gauge, depth, bridges, current, locks and
// their hours, season and closures, the authority and where its notices are published, each fact with its sources.
// The sheets live in data/waterways.json and are matched to a route's legs by the waterway names OSM uses.
import sheets from '../data/waterways.json';
import { haversine, type LngLat } from '../graph/geo';
import type { Route } from './router';

export type Navigable = 'yes' | 'seasonal' | 'restricted' | 'closed';

export interface WaterwayInfo {
  id: string;
  name: string;
  /** waterway names as OpenStreetMap writes them; matched against leg names, ignoring case */
  aliases: string[];
  countries: string[];
  reach: string;
  navigable: Navigable;
  class: string | null;
  lengthKm: number | null;
  depth: { usualM: number | null; maxDraftM: number | null; notes: string | null };
  airDraftM: number | null;
  current: { typicalMs: number | null; notes: string | null };
  locks: { count: number | null; chamber: string | null; hours: string | null; notes: string | null };
  season: { best: string | null; closures: string | null };
  /** tidal reach: spring range and practical notes (tidal limit, timing, streams); absent in older sheets */
  tides?: { tidal: boolean; rangeM: number | null; notes: string | null };
  authority: { name: string; url: string | null };
  notices: string | null;
  notes: string | null;
  sources: string[];
  /** when these facts were checked (YYYY-MM-DD) */
  checked: string;
  /** where the sheet applies (west, south, east, north): sheets sharing a name (La Saône, La Moselle, Open sea) are
   *  told apart by where the leg is */
  bbox?: [number, number, number, number];
}

/** A leg's name and a point halfway along it. */
export interface LegAt {
  name: string;
  at?: LngLat;
}

/** The route's legs with the point halfway along each. */
export function legPoints(route: Route): LegAt[] {
  const c = route.coordinates;
  const out: LegAt[] = [];
  let i = 0, walked = 0, start = 0;
  for (const leg of route.legs) {
    const mid = start + leg.distance / 2;
    while (i < c.length - 1) {
      const step = haversine(c[i][1], c[i][0], c[i + 1][1], c[i + 1][0]);
      if (walked + step >= mid) break;
      walked += step;
      i++;
    }
    out.push({ name: leg.name, at: c[Math.min(i, c.length - 1)] });
    start += leg.distance;
  }
  return out;
}

const inBox = (b: WaterwayInfo['bbox'], p: LngLat | undefined) =>
  !b || !p || (p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]);

/** "tidal, spring range about 0.3 m: notes", or null for non-tidal waterways and sheets without tide data. */
export function tideText(w: WaterwayInfo): string | null {
  const t = w.tides;
  if (!t?.tidal) return null;
  return [t.rangeM !== null ? `tidal, spring range about ${t.rangeM} m` : 'tidal', t.notes].filter(Boolean).join(': ');
}

export const WATERWAYS = sheets as WaterwayInfo[];

const key = (name: string) => name.trim().toLocaleLowerCase();

/** Sheets by alias (several sheets may share one: the Petite and Grande Saône are both "La Saône"). */
export function aliasIndex(infos: WaterwayInfo[] = WATERWAYS): Map<string, WaterwayInfo[]> {
  const index = new Map<string, WaterwayInfo[]>();
  for (const w of infos) for (const a of w.aliases) index.set(key(a), [...(index.get(key(a)) ?? []), w]);
  return index;
}

const DEFAULT_INDEX = aliasIndex();

/** The sheets of the waterways a route's legs follow, in route order, each once (a sheet with a box only where the
 *  leg lies in it). */
export function waterwaysOn(legs: (string | LegAt)[], index: Map<string, WaterwayInfo[]> = DEFAULT_INDEX): WaterwayInfo[] {
  const out: WaterwayInfo[] = [];
  for (const l of legs) {
    const { name, at } = typeof l === 'string' ? { name: l, at: undefined } : l;
    for (const w of index.get(key(name)) ?? []) if (!out.includes(w) && inBox(w.bbox, at)) out.push(w);
  }
  return out;
}

/** Typical current (m/s) by waterway name, for timing; names shared by sheets with different currents take the lower. */
export function currentsByName(infos: WaterwayInfo[] = WATERWAYS): Map<string, number> {
  const out = new Map<string, number>();
  for (const w of infos) {
    const c = w.current.typicalMs;
    if (c === null) continue;
    for (const a of w.aliases) out.set(key(a), Math.min(out.get(key(a)) ?? Infinity, c));
  }
  return out;
}

/** What the boat cannot do on these waterways (deeper or taller than they allow) and what is closed or restricted. */
export function waterwayWarnings(infos: WaterwayInfo[], draft: number, airDraft: number): string[] {
  const out: string[] = [];
  for (const w of infos) {
    // the reasons and dates are in the sheet: the warning says what and as of when
    if (w.navigable === 'closed') out.push(`${w.name}: closed as of ${w.checked}, see About the waterways.`);
    else if (w.navigable === 'restricted') out.push(`${w.name}: navigation restricted as of ${w.checked}, see About the waterways.`);
    if (w.depth.maxDraftM !== null && draft > w.depth.maxDraftM) out.push(`${w.name}: draft ${draft} m exceeds the usual ${w.depth.maxDraftM} m.`);
    if (w.airDraftM !== null && airDraft >= w.airDraftM) out.push(`${w.name}: air draft ${airDraft} m vs lowest bridge ${w.airDraftM} m.`);
  }
  return out;
}
