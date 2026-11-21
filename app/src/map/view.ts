// The map view (centre and zoom) is kept between visits, so the map opens where the user left it: a boater in
// North America should not start over Poland every time. Storage can be missing or throw (private windows).
import type { LngLat } from '../graph/geo';

export const VIEW_KEY = 'interway.view';
export const DEFAULT_VIEW: MapViewState = { center: [19.0, 52.0], zoom: 5.5 };

export interface MapViewState {
  center: LngLat;
  zoom: number;
}

const valid = (v: unknown): v is MapViewState => {
  const o = v as MapViewState | null;
  return !!o && Array.isArray(o.center) && o.center.length === 2 && o.center.every(Number.isFinite)
    && Math.abs(o.center[0]) <= 180 && Math.abs(o.center[1]) <= 85 && Number.isFinite(o.zoom) && o.zoom >= 0 && o.zoom <= 22;
};

export function loadView(): MapViewState {
  try {
    const v: unknown = JSON.parse(localStorage.getItem(VIEW_KEY) ?? 'null');
    return valid(v) ? v : DEFAULT_VIEW;
  } catch {
    return DEFAULT_VIEW;
  }
}

export function saveView(v: MapViewState): void {
  try {
    localStorage.setItem(VIEW_KEY, JSON.stringify({ center: v.center.map((x) => Math.round(x * 1e5) / 1e5), zoom: Math.round(v.zoom * 100) / 100 }));
  } catch {
    // no storage: the map opens at the default view next time
  }
}
