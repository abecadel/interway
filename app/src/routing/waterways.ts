// Researched information about the waterways routes use: navigability, gauge, depth, bridges, current, locks and
// their hours, season and closures, the authority and where its notices are published, each fact with its sources.
// The sheets live in data/waterways.json and are matched to a route's legs by the waterway names OSM uses.
import sheets from '../data/waterways.json';
import { haversine, type LngLat } from '../graph/geo';
import { dateAfter, type Route, type VesselProfile } from './router';

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
  /** typical conditions by month (1 = January): usually closed, low water, high water, ice */
  months?: { closed: number[]; lowWater: number[]; highWater: number[]; ice: number[]; notes: string | null };
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

/** A leg's name, a point halfway along it and its length (m). */
export interface LegAt {
  name: string;
  at?: LngLat;
  distance?: number;
}

/** Legs shorter than this do not bring in a waterway's sheet: a lock basin or junction carrying the name of the
 *  canal that leaves there (the Canal entre Champagne et Bourgogne where it meets the Saône) is not that canal. */
const MIN_LEG_M = 1000;

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
    out.push({ name: leg.name, at: c[Math.min(i, c.length - 1)], distance: leg.distance });
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
    const { name, at, distance } = typeof l === 'string' ? { name: l, at: undefined, distance: undefined } : l;
    if (distance !== undefined && distance < MIN_LEG_M) continue;
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

const MONTH = ['', 'January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const SHORT = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "usually closed Jul–Oct; low water Aug–Sep" from a sheet's months, or null when it has none. */
export function monthsText(w: WaterwayInfo): string | null {
  const m = w.months;
  if (!m) return null;
  const span = (ms: number[]) => {
    const s = [...new Set(ms)].sort((a, b) => a - b);
    const runs: string[] = [];
    let start = s[0], prev = s[0];
    for (const x of [...s.slice(1), 99]) {
      if (x !== prev + 1) {
        runs.push(start === prev ? SHORT[start] : `${SHORT[start]}–${SHORT[prev]}`);
        start = x;
      }
      prev = x;
    }
    return runs.join(', ');
  };
  const parts = [['closed', m.closed], ['low water', m.lowWater], ['high water', m.highWater], ['ice', m.ice]]
    .filter(([, ms]) => (ms as number[]).length).map(([k, ms]) => `${k} ${span(ms as number[])}`);
  return parts.length || m.notes ? [parts.length ? `usually ${parts.join('; ')}` : '', m.notes].filter(Boolean).join('. ') : null;
}

/** For a departure date: what each waterway is usually like in the month the boat reaches it. */
export function seasonWarnings(route: Route, profile: VesselProfile, index: Map<string, WaterwayInfo[]> = DEFAULT_INDEX): string[] {
  if (dateAfter(profile.departure, 0) === null || route.distance <= 0) return [];
  const speed = route.distance / Math.max(route.duration, 1);
  const out: string[] = [];
  const seen = new Set<WaterwayInfo>();
  let closedOnRoute = false;
  let at = 0;
  for (const [i, leg] of legPoints(route).entries()) {
    for (const w of waterwaysOn([leg], index)) {
      if (seen.has(w) || !w.months) continue;
      seen.add(w);
      const date = dateAfter(profile.departure, at / speed)!;
      const m = Number(date.slice(5, 7));
      const what = [w.months.closed.includes(m) ? 'usually closed' : w.months.lowWater.includes(m) && 'low water likely',
        w.months.highWater.includes(m) && 'high water likely', w.months.ice.includes(m) && 'ice likely'].filter(Boolean);
      if (w.months.closed.includes(m)) closedOnRoute = true;
      if (what.length) out.push(`${w.name}, reached around ${date}: ${what.join(', ')} in ${MONTH[m]}${w.months.notes ? ` (${w.months.notes})` : ''}.`);
    }
    at += route.legs[i].distance;
  }
  // when to go instead: the months in which none of this route's waterways is usually closed
  if (closedOnRoute) {
    const closed = new Set([...seen].flatMap((w) => w.months!.closed));
    const months = Array.from({ length: 12 }, (_, k) => k + 1).filter((k) => !closed.has(k));
    out.push(months.length ? `All the waterways of this route are usually open in ${months.map((k) => SHORT[k]).join(', ')}: a trip then avoids these closures.`
      : 'Some waterway of this route is usually closed in every month: compare the alternatives.');
  }
  return out;
}

/** A bridge clearance less than this above the air draft is worth a warning (arches are lower at the sides). */
const NEAR_BRIDGE_M = 0.5;

/** What the boat cannot do on these waterways (deeper or taller than they allow) and what is closed or restricted. */
export function waterwayWarnings(infos: WaterwayInfo[], draft: number, airDraft: number): string[] {
  const out: string[] = [];
  for (const w of infos) {
    // the reasons and dates are in the sheet: the warning says what and as of when
    if (w.navigable === 'closed') out.push(`${w.name}: closed as of ${w.checked}, see About the waterways.`);
    else if (w.navigable === 'restricted') out.push(`${w.name}: navigation restricted as of ${w.checked}, see About the waterways.`);
    if (w.depth.maxDraftM !== null && draft > w.depth.maxDraftM) out.push(`${w.name}: draft ${draft} m exceeds the usual ${w.depth.maxDraftM} m.`);
    if (w.airDraftM !== null && airDraft >= w.airDraftM) out.push(`${w.name}: air draft ${airDraft} m vs lowest bridge ${w.airDraftM} m.`);
    else if (w.airDraftM !== null && airDraft > w.airDraftM - NEAR_BRIDGE_M) {
      out.push(`${w.name}: lowest bridge ${w.airDraftM} m leaves ${Math.round((w.airDraftM - airDraft) * 100) / 100} m above your air draft`
        + ` ${airDraft} m; arched bridges are lower towards the sides: see About the waterways.`);
    }
  }
  return out;
}
