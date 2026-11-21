// A private catch log: kept only in this browser (no account, no server), exported as CSV, GPX or GeoJSON.
import type { LngLat } from '../graph/geo';

export const CATCH_KEY = 'interway.catches';

export interface Catch {
  id: string;
  /** ISO time */
  time: string;
  position: LngLat;
  place: string;
  species: string;
  lengthCm?: number;
  weightKg?: number;
  released?: boolean;
  notes?: string;
  /** the conditions when it was caught, as text (wind, pressure, moon) */
  conditions?: string;
}

export function loadCatches(storage: Storage = localStorage): Catch[] {
  try {
    const v = JSON.parse(storage.getItem(CATCH_KEY) ?? '[]');
    return Array.isArray(v) ? v.filter((c) => typeof c?.species === 'string' && Array.isArray(c.position)) : [];
  } catch {
    return [];
  }
}

function store(list: Catch[], storage: Storage): Catch[] {
  try {
    storage.setItem(CATCH_KEY, JSON.stringify(list));
  } catch {
    // storage blocked or full: kept for this visit only
  }
  return list;
}

export function addCatch(list: Catch[], c: Omit<Catch, 'id'>, storage: Storage = localStorage, id = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`): Catch[] {
  return store([{ id, ...c }, ...list], storage);
}

export function removeCatch(list: Catch[], id: string, storage: Storage = localStorage): Catch[] {
  return store(list.filter((c) => c.id !== id), storage);
}

const csvCell = (v: unknown) => {
  const s = v === undefined || v === null ? '' : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function catchesCsv(list: Catch[]): string {
  const head = ['time', 'species', 'length_cm', 'weight_kg', 'released', 'place', 'lon', 'lat', 'conditions', 'notes'];
  const rows = list.map((c) => [c.time, c.species, c.lengthCm, c.weightKg, c.released === undefined ? '' : c.released ? 'yes' : 'no', c.place,
    c.position[0], c.position[1], c.conditions, c.notes].map(csvCell).join(','));
  return [head.join(','), ...rows].join('\n') + '\n';
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function catchesGpx(list: Catch[]): string {
  const wpts = list.map((c) => `  <wpt lat="${c.position[1].toFixed(6)}" lon="${c.position[0].toFixed(6)}"><time>${esc(c.time)}</time>`
    + `<name>${esc(c.species)}</name><desc>${esc([c.lengthCm && `${c.lengthCm} cm`, c.weightKg && `${c.weightKg} kg`, c.place, c.notes].filter(Boolean).join(', '))}</desc></wpt>`);
  return `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="Interway" xmlns="http://www.topografix.com/GPX/1/1">\n${wpts.join('\n')}\n</gpx>\n`;
}

export function catchesGeoJson(list: Catch[]): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: list.map(({ position, ...p }) => ({ type: 'Feature', properties: p, geometry: { type: 'Point', coordinates: position } })),
  });
}
