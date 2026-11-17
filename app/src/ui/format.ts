import type { LngLat } from '../graph/geo';
import type { Stop } from '../routing/itinerary';
import type { Route } from '../routing/router';
import type { Poi, PoiType } from '../routing/service';

export const fmtKm = (m: number) => (m >= 10_000 ? `${(m / 1000).toFixed(0)} km` : `${(m / 1000).toFixed(1)} km`);
export const fmtNm = (m: number) => `${(m / 1852).toFixed(1)} NM`;

export function fmtDuration(s: number) {
  const h = Math.floor(s / 3600);
  const min = Math.round((s % 3600) / 60);
  if (h >= 24) return `${Math.floor(h / 24)} d ${h % 24} h`;
  return h > 0 ? `${h} h ${min} min` : `${min} min`;
}

export function fmtPos([lon, lat]: LngLat) {
  const f = (v: number, pos: string, neg: string) => `${Math.abs(v).toFixed(4)}°${v >= 0 ? pos : neg}`;
  return `${f(lat, 'N', 'S')} ${f(lon, 'E', 'W')}`;
}

export function toGpx(route: Route, name = 'Interway route', stops: Stop[] = []): string {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const pts = route.coordinates.map(([lon, lat]) => `      <rtept lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"/>`).join('\n');
  // Itinerary stops when known (locks, fuel, marinas...), otherwise the locks the router passed.
  const marks = stops.length
    ? stops.map((s) => ({ lat: s.poi.lat, lon: s.poi.lon, name: s.poi.name || POI_LABEL[s.poi.type], type: s.poi.type }))
    : route.events.map((e) => ({ lat: e.lat, lon: e.lon, name: e.name, type: 'lock' }));
  const wpts = marks
    .map((m) => `  <wpt lat="${m.lat.toFixed(6)}" lon="${m.lon.toFixed(6)}"><name>${esc(m.name)}</name><type>${m.type}</type></wpt>`)
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="Interway" xmlns="http://www.topografix.com/GPX/1/1">
${wpts}
  <rte>
    <name>${esc(name)}</name>
${pts}
  </rte>
</gpx>
`;
}

export const POI_LABEL: Record<PoiType, string> = {
  lock: 'Lock',
  bridge: 'Bridge',
  marina: 'Marina',
  port: 'Port',
  fuel: 'Fuel',
  slipway: 'Slipway',
  water: 'Water',
  sanitary: 'Pump-out',
  place: 'Town',
};

export const POI_PLURAL: Record<PoiType, string> = {
  lock: 'locks',
  bridge: 'bridges',
  marina: 'marinas',
  port: 'ports',
  fuel: 'fuel stations',
  slipway: 'slipways',
  water: 'water points',
  sanitary: 'pump-outs',
  place: 'towns',
};

/** "1 lock", "3 locks" */
export const countLabel = (n: number, t: PoiType) => `${n} ${n === 1 ? POI_LABEL[t].toLowerCase() : POI_PLURAL[t]}`;

/** Short detail shown next to a stop: lock chamber size or bridge clearance. */
export function poiDetail(p: Poi): string {
  if (p.clearance !== undefined) return `clearance ${p.clearance.toFixed(1)} m`;
  if (p.maxlength !== undefined && p.maxwidth !== undefined) return `${p.maxlength} × ${p.maxwidth} m`;
  return '';
}
