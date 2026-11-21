// Recent searches and saved places, kept in this browser.
import type { LngLat } from '../graph/geo';
import type { Place } from './search';

export const RECENT_KEY = 'interway.recent';
export const SAVED_KEY = 'interway.saved';
const MAX_RECENT = 8;
const same = (a: Place, b: Place) => a.label === b.label && a.position[0] === b.position[0] && a.position[1] === b.position[1];

export function loadPlaces(key: string): Place[] {
  try {
    const v = JSON.parse(localStorage.getItem(key) ?? '[]');
    return Array.isArray(v) ? v.filter((p) => typeof p?.label === 'string' && Array.isArray(p.position)) : [];
  } catch {
    return [];
  }
}

function store(key: string, list: Place[]): Place[] {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {
    // storage blocked: kept for this visit only
  }
  return list;
}

/** The place first, without an earlier copy, at most MAX_RECENT. */
export function addRecent(list: Place[], p: Place): Place[] {
  return store(RECENT_KEY, [p, ...list.filter((q) => !same(q, p))].slice(0, MAX_RECENT));
}

export function isSaved(list: Place[], p: Place): boolean {
  return list.some((q) => same(q, p));
}

export function toggleSaved(list: Place[], p: Place): Place[] {
  return store(SAVED_KEY, isSaved(list, p) ? list.filter((q) => !same(q, p)) : [...list, p]);
}

/** A link that opens this place's card (the harbour, lock or town there), from which directions start. */
export const shareLink = (p: LngLat, loc: Location = location) =>
  `${loc.origin}${loc.pathname}?place=${p[0].toFixed(5)},${p[1].toFixed(5)}`;

/** A spot shared "approximately": rounded to 0.01° (about 1 km), so a good fishing place is not given away exactly. */
export const approximate = ([lon, lat]: LngLat): LngLat => [Math.round(lon * 100) / 100, Math.round(lat * 100) / 100];
