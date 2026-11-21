// The route service's engine: the same router, waterway sheets and brief as the web app, run on a server so that a
// chat assistant without a browser (ChatGPT, Claude) can plan a route with a plain link or an MCP tool call.
import { decodeGeometry, decodeGraph } from '../graph/format';
import type { LngLat } from '../graph/geo';
import { buildItinerary } from '../routing/itinerary';
import { defaultProfile, Router, type Route, type VesselProfile } from '../routing/router';
import type { Manifest, Poi } from '../routing/service';
import { currentsByName, WATERWAYS } from '../routing/waterways';
import { buildBrief, briefMarkdown, type RouteBrief } from '../ui/brief';
import { buildLocalIndex, fold, type LocalIndex } from '../ui/localSearch';
import type { Place } from '../ui/search';
import { parsePoint, permalink, VESSEL_PARAMS } from '../ui/urlState';

/** Reads a data file (graph.bin, geom.bin, manifest.json, pois.json) as bytes. */
export type ReadFile = (name: string) => Promise<ArrayBuffer>;

export interface Engine {
  router: Router;
  manifest: Manifest;
  pois: Poi[];
  index: LocalIndex;
  /** the data version permalinks record (the graph's checksum, else its build time) */
  dataId: string | null;
  /** online place search for names the data does not have (small towns, beaches); none offline */
  geocode?: (query: string) => Promise<Place[]>;
}

const text = (b: ArrayBuffer) => new TextDecoder().decode(b);

export async function loadEngine(read: ReadFile, geocode?: Engine['geocode']): Promise<Engine> {
  const manifest = JSON.parse(text(await read('manifest.json'))) as Manifest;
  const [g, s] = await Promise.all([read(manifest.files.graph), read(manifest.files.geom)]);
  const router = new Router(decodeGraph(g), decodeGeometry(s), manifest.names);
  router.setCurrents(currentsByName());
  router.setWaterways(WATERWAYS);
  const pois = manifest.files.pois ? (JSON.parse(text(await read(manifest.files.pois))) as Poi[]) : [];
  return { router, manifest, pois, index: buildLocalIndex(pois), dataId: manifest.sha256?.graph?.slice(0, 12) ?? manifest.built ?? null, geocode };
}

/** A point given as "lon,lat" or a place name (a town, marina, port or lock in the data). */
export interface Resolved {
  position: LngLat;
  label: string;
}

export class RequestError extends Error {}

/** Limits that keep one request cheap: a route visits at most MAX_STOPS stops, a place name is at most
 *  MAX_PLACE_CHARS long. */
export const MAX_STOPS = 25;
export const MAX_PLACE_CHARS = 120;

/** A small least-recently-used cache. */
export class Lru<V> {
  private map = new Map<string, V>();
  private size: number;
  constructor(size: number) {
    this.size = size;
  }
  get(k: string): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }
  delete(k: string): void {
    this.map.delete(k);
  }
  set(k: string, v: V): void {
    this.map.delete(k);
    this.map.set(k, v);
    if (this.map.size > this.size) this.map.delete(this.map.keys().next().value!);
  }
}

/** The online search, each name asked once (the public geocoder is shared: be gentle with it). */
export function cachedGeocoder(geocode: (q: string) => Promise<Place[]>, size = 2000): (q: string) => Promise<Place[]> {
  const cache = new Lru<Promise<Place[]>>(size);
  return (q) => {
    const k = fold(q.trim());
    let hit = cache.get(k);
    if (!hit) {
      hit = geocode(q).catch(() => []);
      cache.set(k, hit);
    }
    return hit;
  };
}

/** Coordinates as given; else a place in the data whose name starts with the text (marinas, locks, towns);
 *  else the online search; else any place in the data containing the text. */
export async function resolvePlace(engine: Engine, value: string, what: string): Promise<Resolved> {
  if (value.length > MAX_PLACE_CHARS) throw new RequestError(`${what} is too long (at most ${MAX_PLACE_CHARS} characters)`);
  const p = parsePoint(value);
  if (p) return { position: p, label: value };
  const local = engine.index.search(value, undefined, 1)[0];
  const name = (h: Place) => h.label.split(' · ')[0];
  if (local && fold(name(local)).startsWith(fold(value.trim()))) return { position: local.position, label: name(local) };
  const online = engine.geocode ? (await engine.geocode(value).catch(() => []))[0] : undefined;
  const hit = online ?? local;
  if (!hit) throw new RequestError(`No place found for ${what} "${value}": give coordinates as lon,lat, or another name`);
  return { position: hit.position, label: name(hit) };
}

/** What a route request carries: the points as given (names or coordinates) and the vessel. */
export interface RouteRequest {
  from: string;
  to: string;
  via: string[];
  vessel: Partial<VesselProfile>;
}

const FLAGS = ['avoidLocks', 'avoidSea', 'coastal'] as const;

/** Reads a route request from link parameters (the website's: from, to, via, draft, air, ...). */
export function parseRequest(q: URLSearchParams): RouteRequest {
  const from = q.get('from')?.trim(), to = q.get('to')?.trim();
  if (!from || !to) throw new RequestError('Give from and to (place names, or lon,lat)');
  const via = (q.get('via') ?? '').split(/[;|]/).map((v) => v.trim()).filter(Boolean);
  if (via.length > MAX_STOPS) throw new RequestError(`At most ${MAX_STOPS} stops (via)`);
  const vessel: Partial<VesselProfile> = {};
  for (const [param, field] of Object.entries(VESSEL_PARAMS)) {
    const raw = q.get(param);
    if (raw === null || raw.trim() === '') continue;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) throw new RequestError(`${param} must be a number`);
    vessel[field] = n;
  }
  for (const f of FLAGS) if (q.has(f)) vessel[f] = q.get(f) === '1' || q.get(f) === 'true';
  const date = q.get('date');
  if (date) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new RequestError('date must be YYYY-MM-DD');
    vessel.departure = date;
  }
  return { from, to, via, vessel };
}

/** The request as link parameters again (names kept as given), for the service's own link. */
export function requestParams(r: RouteRequest): URLSearchParams {
  const q = new URLSearchParams({ from: r.from, to: r.to });
  if (r.via.length) q.set('via', r.via.join(';'));
  for (const [param, field] of Object.entries(VESSEL_PARAMS)) if (r.vessel[field] !== undefined) q.set(param, String(r.vessel[field]));
  for (const f of FLAGS) if (r.vessel[f]) q.set(f, '1');
  if (r.vessel.departure) q.set('date', r.vessel.departure);
  return q;
}

export interface Planned {
  brief: RouteBrief;
  markdown: string;
  /** the website link with every setting, the data version and the route's distance and locks */
  permalink: string;
  /** this service's link for the same request: change its parameters to edit the route */
  serviceLink: string;
  route: Route;
}

export async function plan(engine: Engine, r: RouteRequest, opts: { site: string; service: string }): Promise<Planned> {
  const from = await resolvePlace(engine, r.from, 'from'), to = await resolvePlace(engine, r.to, 'to');
  const via: Resolved[] = [];
  for (const [i, v] of r.via.entries()) via.push(await resolvePlace(engine, v, `via[${i}]`));
  const profile = { ...defaultProfile, ...r.vessel };
  let route: Route;
  try {
    route = engine.router.routeVia([from.position, ...via.map((v) => v.position), to.position], profile);
  } catch (e) {
    throw new RequestError((e as Error).message);
  }
  const link = permalink(opts.site, { from: from.position, to: to.position, via: via.map((v) => v.position) }, profile, engine.dataId,
    { km: Math.round(route.distance / 100) / 10, locks: route.locks });
  const brief = buildBrief({
    route, itinerary: buildItinerary(route, engine.pois), profile, title: `${from.label} → ${to.label}`, link,
    entered: new Set(Object.keys(r.vessel)), data: engine.dataId,
  });
  const serviceLink = `${opts.service}/api/route?${requestParams(r).toString()}`;
  return { brief, markdown: briefMarkdown(brief), permalink: link, serviceLink, route };
}

/** Changes to a route an assistant can ask for: add, move or remove a stop, change the vessel or the ends. */
export interface Edit {
  add_stop?: { place: string; index?: number };
  remove_stop?: { index: number };
  move_stop?: { from: number; to: number };
  from?: string;
  to?: string;
  vessel?: Partial<VesselProfile>;
}

export function applyEdit(r: RouteRequest, e: Edit): RouteRequest {
  const via = [...r.via];
  if (e.remove_stop) {
    if (!(e.remove_stop.index >= 0 && e.remove_stop.index < via.length)) throw new RequestError(`No stop ${e.remove_stop.index}: the route has ${via.length}`);
    via.splice(e.remove_stop.index, 1);
  }
  if (e.move_stop) {
    const { from, to } = e.move_stop;
    if (!(from >= 0 && from < via.length && to >= 0 && to < via.length)) throw new RequestError(`Stops are numbered 0 to ${via.length - 1}`);
    via.splice(to, 0, ...via.splice(from, 1));
  }
  if (e.add_stop) {
    const i = e.add_stop.index ?? via.length;
    if (!(i >= 0 && i <= via.length)) throw new RequestError(`A stop can go at 0 to ${via.length}`);
    via.splice(i, 0, e.add_stop.place);
    if (via.length > MAX_STOPS) throw new RequestError(`At most ${MAX_STOPS} stops`);
  }
  return { from: e.from ?? r.from, to: e.to ?? r.to, via, vessel: { ...r.vessel, ...e.vessel } };
}

/** A route request from a link: this service's /api/route link or a website (perma)link. */
export function requestFromLink(link: string): RouteRequest {
  let url: URL;
  try {
    url = new URL(link);
  } catch {
    throw new RequestError('link must be a full Interway link (https://...)');
  }
  return parseRequest(url.searchParams);
}
