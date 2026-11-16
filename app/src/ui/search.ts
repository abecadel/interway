import type { LngLat } from '../graph/geo';

export interface Place {
  label: string;
  position: LngLat;
}

/** Geocoding via Photon (komoot), free OSM-based search. Needs network; offline index comes later. */
export async function searchPlaces(query: string, near?: LngLat, signal?: AbortSignal): Promise<Place[]> {
  const url = new URL('https://photon.komoot.io/api/');
  url.searchParams.set('q', query);
  url.searchParams.set('limit', '6');
  if (near) {
    url.searchParams.set('lon', String(near[0]));
    url.searchParams.set('lat', String(near[1]));
  }
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`Search failed: HTTP ${res.status}`);
  const data = (await res.json()) as GeoJSON.FeatureCollection<GeoJSON.Point, Record<string, string>>;
  return data.features.map((f: GeoJSON.Feature<GeoJSON.Point, Record<string, string>>) => {
    const p = f.properties;
    const label = [p.name, p.city !== p.name ? p.city : undefined, p.country].filter(Boolean).join(', ');
    return { label, position: f.geometry.coordinates as LngLat };
  });
}
