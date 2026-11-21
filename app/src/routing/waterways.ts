// Researched information about the waterways routes use: navigability, gauge, depth, bridges, current, locks and
// their hours, season and closures, the authority and where its notices are published, each fact with its sources.
// The sheets live in data/waterways.json and are matched to a route's legs by the waterway names OSM uses.
import sheets from '../data/waterways.json';

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
  authority: { name: string; url: string | null };
  notices: string | null;
  notes: string | null;
  sources: string[];
  checked: string;
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

/** The sheets of the waterways a route's legs follow, in route order, each once. */
export function waterwaysOn(legNames: string[], index: Map<string, WaterwayInfo[]> = DEFAULT_INDEX): WaterwayInfo[] {
  const out: WaterwayInfo[] = [];
  for (const n of legNames) for (const w of index.get(key(n)) ?? []) if (!out.includes(w)) out.push(w);
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
    if (w.navigable === 'closed') out.push(`${w.name}: closed (${w.notes ?? 'see the notices'}).`);
    else if (w.navigable === 'restricted') out.push(`${w.name}: navigation restricted (${w.notes ?? 'see the notices'}).`);
    if (w.depth.maxDraftM !== null && draft > w.depth.maxDraftM) out.push(`${w.name}: draft ${draft} m exceeds the usual ${w.depth.maxDraftM} m.`);
    if (w.airDraftM !== null && airDraft >= w.airDraftM) out.push(`${w.name}: air draft ${airDraft} m vs lowest bridge ${w.airDraftM} m.`);
  }
  return out;
}
