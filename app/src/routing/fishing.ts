// Fishing rules by country (data/fishing.json, researched from official sources): the licence and the permit for
// the water, what a visitor needs, where fishing is banned, rules from a boat, at sea the catch reporting duty,
// and the closed seasons, minimum sizes and bag limits of the main species, with sources and the date checked.
import data from '../data/fishing.json';
import { haversine, type LngLat } from '../graph/geo';
import type { Poi } from './service';

export interface FishingWaters {
  licence: string | null;
  permit?: string | null;
  visitors: string | null;
  reporting?: string | null;
  bans: string | null;
  boat: string | null;
}

export interface Season {
  species: string;
  waters: 'inland' | 'sea' | 'all';
  /** closed periods as MM-DD ranges, which may wrap the year (["11-01","02-28"]) */
  closed: [string, string][];
  minSizeCm: number | null;
  bag: string | null;
  notes: string | null;
}

export interface FishingRules {
  inland: FishingWaters | null;
  sea: FishingWaters | null;
  seasons: Season[];
  buy: string | null;
  authority: { name: string; url: string | null };
  sources: string[];
  checked: string;
}

export const FISHING = data as unknown as Record<string, FishingRules>;

const MONTH = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const md = (s: string) => `${Number(s.slice(3, 5))} ${MONTH[Number(s.slice(0, 2))]}`;

/** "1 Jan–30 Apr" */
export const rangeText = ([a, b]: [string, string]) => `${md(a)}–${md(b)}`;

/** Whether the day (YYYY-MM-DD or MM-DD) falls in a closed range; ranges may wrap the new year. */
export function inRange(day: string, [a, b]: [string, string]): boolean {
  const d = day.length > 5 ? day.slice(5, 10) : day;
  return a <= b ? d >= a && d <= b : d >= a || d <= b;
}

/** The seasons closed on a day, for the waters given ('inland', 'sea' or both). */
export function closedOn(rules: FishingRules, day: string, waters: ('inland' | 'sea')[] = ['inland', 'sea']): Season[] {
  return rules.seasons.filter((s) => (s.waters === 'all' || waters.includes(s.waters)) && s.closed.some((r) => inRange(day, r)));
}

/** "Pike (szczupak): closed 1 Jan–30 Apr; at least 50 cm; 2 per day" */
export function seasonText(s: Season): string {
  return [s.species, [s.closed.length && `closed ${s.closed.map(rangeText).join(', ')}`, s.minSizeCm !== null && `at least ${s.minSizeCm} cm`, s.bag,
    s.notes].filter(Boolean).join('; ')].join(': ');
}

/** The country of a place: that of the nearest town within `within` metres (towns carry their country code). */
export function countryAt([lon, lat]: LngLat, pois: Poi[], within = 30_000): string | null {
  let best: Poi | null = null, d = within;
  for (const p of pois) {
    if (p.type !== 'place' || !p.cc) continue;
    const x = haversine(lat, lon, p.lat, p.lon);
    if (x <= d) { d = x; best = p; }
  }
  return best?.cc ?? null;
}

/** The days of a trip, YYYY-MM-DD, from the first to the last (inclusive), at most a year. */
export function tripDays(first: string, last: string): string[] {
  const out: string[] = [];
  const d = new Date(`${first}T12:00:00Z`), end = new Date(`${last}T12:00:00Z`);
  while (d <= end && out.length < 366) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}
