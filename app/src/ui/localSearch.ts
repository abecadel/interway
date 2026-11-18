// Offline search over the waterway places in the downloaded data (towns, marinas, ports, locks, fuel...).
import { haversine, type LngLat } from '../graph/geo';
import type { Poi, PoiType } from '../routing/service';
import { POI_LABEL } from './format';
import type { Place } from './search';

/** lowercase, accents and Polish/German/Nordic letters folded, so "Gizycko" finds "Giżycko" */
export function fold(s: string): string {
  return s
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[łŁ]/g, 'l')
    .replace(/[øØ]/g, 'o')
    .replace(/[æÆ]/g, 'ae')
    .replace(/đ/g, 'd')
    .normalize('NFD')
    .replace(/\p{M}/gu, '');
}

const KIND_WEIGHT: Partial<Record<PoiType, number>> = { place: 3, marina: 2, port: 2, lock: 1, fuel: 1 };
const LIMIT = 6;

interface Entry {
  poi: Poi;
  key: string;
}

export interface LocalIndex {
  search(query: string, near?: LngLat, limit?: number): Place[];
}

export function buildLocalIndex(pois: Poi[]): LocalIndex {
  const entries: Entry[] = pois.filter((p) => p.name).map((poi) => ({ poi, key: fold(poi.name) }));
  return {
    search(query, near, limit = LIMIT) {
      const q = fold(query.trim());
      if (q.length < 2) return [];
      const scored: { e: Entry; score: number; d: number }[] = [];
      for (const e of entries) {
        const i = e.key.indexOf(q);
        if (i < 0) continue;
        const atWord = i === 0 ? 3 : /[\s\-'(/.,]/.test(e.key[i - 1]) ? 2 : 1;
        const exact = e.key.length === q.length ? 1 : 0;
        const d = near ? haversine(near[1], near[0], e.poi.lat, e.poi.lon) : 0;
        scored.push({ e, score: atWord * 10 + exact * 5 + (KIND_WEIGHT[e.poi.type] ?? 0), d });
      }
      scored.sort((a, b) => b.score - a.score || a.d - b.d);
      const out: Place[] = [];
      for (const { e } of scored) {
        const label = `${e.poi.name} · ${POI_LABEL[e.poi.type].toLowerCase()}`;
        // the same place mapped twice (two marina nodes) shows once
        if (out.some((o) => o.label === label && haversine(o.position[1], o.position[0], e.poi.lat, e.poi.lon) < 1000)) continue;
        out.push({ label, position: [e.poi.lon, e.poi.lat] });
        if (out.length >= limit) break;
      }
      return out;
    },
  };
}

/** Local results first, then online ones that are not the same place (within 500 m and named alike). */
export function mergePlaces(local: Place[], online: Place[], limit = 8): Place[] {
  const out = [...local];
  for (const p of online) {
    const dup = local.some((l) => haversine(l.position[1], l.position[0], p.position[1], p.position[0]) < 500
      && fold(p.label).startsWith(fold(l.label.split(' · ')[0])));
    if (!dup) out.push(p);
  }
  return out.slice(0, limit);
}
