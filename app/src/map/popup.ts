import type { LngLat } from '../graph/geo';
import type { Stop } from '../routing/itinerary';
import type { PoiType } from '../routing/service';
import { fmtKm, POI_LABEL } from '../ui/format';

/** Kind, name, chamber size or clearance, and where it is on the route. */
export function popupContent(props: Record<string, unknown>, [lon, lat]: LngLat, stops: Stop[]): HTMLElement {
  const el = document.createElement('div');
  el.className = 'poi-popup';
  const kind = document.createElement('b');
  kind.textContent = POI_LABEL[props.type as PoiType] ?? 'Lock';
  el.append(kind);
  const lines = [String(props.name ?? ''), String(props.detail ?? '')];
  const stop = stops.find((s) => Math.abs(s.poi.lon - lon) < 1e-6 && Math.abs(s.poi.lat - lat) < 1e-6);
  const at = typeof props.at === 'number' ? props.at : stop?.at;
  if (at !== undefined) lines.push(`km ${(at / 1000).toFixed(1)} on the route`);
  if (stop && stop.offset > 60) lines.push(`${fmtKm(stop.offset)} off the route`);
  for (const text of lines.filter(Boolean)) {
    const div = document.createElement('div');
    div.textContent = text;
    el.append(div);
  }
  return el;
}
