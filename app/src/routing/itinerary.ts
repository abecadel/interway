// What a route passes: locks, bridges, fuel, marinas, ports... ordered by distance from the start.
import Flatbush from 'flatbush';
import { haversine, projectOnSegment, type LngLat } from '../graph/geo';
import type { Route } from './router';
import type { Poi, PoiType } from './service';

export interface Stop {
  poi: Poi;
  /** distance from the start of the route, m */
  at: number;
  /** distance from the route line, m */
  offset: number;
}

export interface Itinerary {
  stops: Stop[];
  counts: Partial<Record<PoiType, number>>;
  /** lowest bridge clearance on the route, m (undefined when none is known) */
  minClearance?: number;
  /** the lowest bridge, the narrowest and the shortest lock on the route (those that limit the boat) */
  lowestBridge?: Stop;
  narrowestLock?: Stop;
  shortestLock?: Stop;
}

/** Services count when within this distance of the route; locks and bridges are on it. */
export const NEAR_M = 300;
const ON_ROUTE_M = 60;
/** towns the route passes through or by */
export const PLACE_M = 3000;
/** at sea, marinas and ports this close to the line are ports of refuge along it (the sea network keeps off the shore) */
export const SEA_HARBOUR_M = 12_000;

const isOnRoute = (t: PoiType) => t === 'lock' || t === 'bridge';

export function buildItinerary(route: Route, pois: Poi[]): Itinerary {
  const c = route.coordinates;
  const along = [0];
  for (let i = 1; i < c.length; i++) along.push(along[i - 1] + haversine(c[i - 1][1], c[i - 1][0], c[i][1], c[i][0]));
  const stops: Stop[] = [];
  if (c.length >= 2 && pois.length) {
    const index = new Flatbush(c.length - 1);
    for (let i = 0; i < c.length - 1; i++) {
      index.add(Math.min(c[i][0], c[i + 1][0]), Math.min(c[i][1], c[i + 1][1]), Math.max(c[i][0], c[i + 1][0]), Math.max(c[i][1], c[i + 1][1]));
    }
    index.finish();
    const sea = seaSpans(route);
    const atSea = (at: number) => sea.some(([a, b]) => at >= a && at <= b);
    for (const poi of pois) {
      const harbour = poi.type === 'marina' || poi.type === 'port';
      const limit = isOnRoute(poi.type) ? ON_ROUTE_M : poi.type === 'place' ? PLACE_M : harbour && sea.length ? SEA_HARBOUR_M : NEAR_M;
      const best = nearest(c, along, index, [poi.lon, poi.lat], limit);
      if (best && (best.offset <= NEAR_M || !harbour || atSea(best.at))) stops.push({ poi, ...best });
    }
  }
  stops.sort((x, y) => x.at - y.at);
  const merged = dedupe(stops);
  const counts: Partial<Record<PoiType, number>> = {};
  let lowestBridge: Stop | undefined, narrowestLock: Stop | undefined, shortestLock: Stop | undefined;
  for (const s of merged) {
    const { poi } = s;
    counts[poi.type] = (counts[poi.type] ?? 0) + 1;
    if (poi.clearance !== undefined && (!lowestBridge || poi.clearance < lowestBridge.poi.clearance!)) lowestBridge = s;
    if (poi.maxwidth && (!narrowestLock || poi.maxwidth < narrowestLock.poi.maxwidth!)) narrowestLock = s;
    if (poi.maxlength && (!shortestLock || poi.maxlength < shortestLock.poi.maxlength!)) shortestLock = s;
  }
  return { stops: merged, counts, minClearance: lowestBridge?.poi.clearance, lowestBridge, narrowestLock, shortestLock };
}

/** [from, to] metres of the open-sea legs (named "Open sea" by the router) */
export function seaSpans(route: Pick<Route, 'legs'>): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (const l of route.legs ?? []) {
    if (l.name === 'Open sea') out.push([at, at + l.distance]);
    at += l.distance;
  }
  return out;
}

/** The same thing mapped twice (a named lock patch and an automatic join, two marina nodes): keep one, named first. */
const SAME_M = 150;
function dedupe(stops: Stop[]): Stop[] {
  const out: Stop[] = [];
  for (const s of stops) {
    const twin = out.find((o) => o.poi.type === s.poi.type && s.at - o.at < SAME_M
      && (!o.poi.name || !s.poi.name || o.poi.name === s.poi.name));
    if (!twin) out.push(s);
    else if (!twin.poi.name && s.poi.name) out[out.indexOf(twin)] = s;
  }
  return out;
}

function nearest(c: LngLat[], along: number[], index: Flatbush, [lon, lat]: LngLat, limit: number) {
  // search box in degrees, generous in longitude for high latitudes
  const dy = limit / 111_000;
  const dx = dy / Math.max(Math.cos((lat * Math.PI) / 180), 0.2);
  let best: { at: number; offset: number } | null = null;
  for (const i of index.search(lon - dx, lat - dy, lon + dx, lat + dy)) {
    const pr = projectOnSegment(lat, lon, c[i][1], c[i][0], c[i + 1][1], c[i + 1][0]);
    if (pr.dist <= limit && (!best || pr.dist < best.offset)) {
      best = { at: along[i] + (along[i + 1] - along[i]) * pr.t, offset: pr.dist };
    }
  }
  return best;
}
