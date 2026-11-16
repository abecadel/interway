export type LngLat = [number, number];

const R = 6371008.8;
const toRad = Math.PI / 180;

export function haversine(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * toRad) * Math.cos(lat2 * toRad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/**
 * Closest point on segment AB to P using a local equirectangular projection (accurate enough at segment scale).
 * Returns the fraction t along AB (0..1) and the distance in metres.
 */
export function projectOnSegment(
  pLat: number, pLon: number, aLat: number, aLon: number, bLat: number, bLon: number,
): { t: number; dist: number; lat: number; lon: number } {
  const k = Math.cos(pLat * toRad);
  const ax = (aLon - pLon) * k, ay = aLat - pLat;
  const bx = (bLon - pLon) * k, by = bLat - pLat;
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  const lat = aLat + (bLat - aLat) * t;
  const lon = aLon + (bLon - aLon) * t;
  return { t, lat, lon, dist: haversine(pLat, pLon, lat, lon) };
}

export const metresToNm = (m: number) => m / 1852;
