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

/** how far the place card's Nearby tab looks */
export const NEARBY_M = 5000;

/** The nearest services and structures (not towns) around a place, the place itself left out. */
export function nearbyPois(pois: Poi[], [lon, lat]: LngLat, limit = 8): { poi: Poi; d: number }[] {
  return pois
    .filter((p) => p.type !== 'place' && Math.abs(p.lat - lat) < 0.05)
    .map((poi) => ({ poi, d: haversine(lat, lon, poi.lat, poi.lon) }))
    .filter(({ d }) => d > 1 && d <= NEARBY_M)
    .sort((a, b) => a.d - b.d)
    .slice(0, limit);
}
