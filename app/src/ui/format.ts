import type { LngLat } from '../graph/geo';
import type { Route } from '../routing/router';

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

export function toGpx(route: Route, name = 'Interway route'): string {
  const esc = (s: string) => s.replace(/[<>&"]/g, (c) => `&#${c.charCodeAt(0)};`);
  const pts = route.coordinates.map(([lon, lat]) => `      <rtept lat="${lat.toFixed(6)}" lon="${lon.toFixed(6)}"/>`).join('\n');
  const wpts = route.events
    .map((e) => `  <wpt lat="${e.lat.toFixed(6)}" lon="${e.lon.toFixed(6)}"><name>${esc(e.name)}</name><type>lock</type></wpt>`)
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
