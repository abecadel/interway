import { haversine, type LngLat } from '../graph/geo';
import type { Poi, PoiType } from '../routing/service';

export const CATEGORIES: [PoiType, string][] = [
  ['marina', 'Marinas'], ['port', 'Harbours'], ['fuel', 'Fuel'], ['lock', 'Locks'],
  ['slipway', 'Slipways'], ['water', 'Water'], ['sanitary', 'Toilets'],
  ['fishing', 'Fishing spots'], ['tackle', 'Tackle shops'], ['wreck', 'Wrecks'],
];
const LIMIT = 20;

/** The nearest places of one kind to the map centre. */
export function nearest(pois: Poi[], type: PoiType, center: LngLat, limit = LIMIT): { poi: Poi; d: number }[] {
  return pois
    .filter((p) => p.type === type)
    .map((poi) => ({ poi, d: haversine(center[1], center[0], poi.lat, poi.lon) }))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit);
}
