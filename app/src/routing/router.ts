import Flatbush from 'flatbush';
import { COORD_SCALE, Flag, type Geometry, type Graph } from '../graph/format';
import { haversine, projectOnSegment, type LngLat } from '../graph/geo';
import { MinHeap } from './heap';

export interface VesselProfile {
  /** cruising speed through water, km/h */
  speedKmh: number;
  /** assumed river current, m/s (added downstream, subtracted upstream) */
  currentMs: number;
  draft: number;
  airDraft: number;
  beam: number;
  length: number;
  /** minutes added per lock */
  lockPenaltyMin: number;
  avoidLocks: boolean;
  /** keep to inland waterways where any inland way exists (open sea costs 10x instead of SEA_COST) */
  avoidSea: boolean;
  /** keep near the coast, harbour to harbour: open sea more than 10 km from land costs COASTAL_COST more */
  coastal: boolean;
  /** departure date (YYYY-MM-DD), or '': with it, waterways usually closed in the month they are reached are avoided */
  departure: string;
}

/** Open sea counts this much more than inland water of the same length: weather, swell and tides make it the
 * less obvious choice when an inland way is comparable (Wrocław → Amsterdam via the Mittellandkanal, not the
 * Wadden coast). Reported durations are real time without these penalties. */
export const SEA_COST = 1.5;
const AVOID_SEA_COST = 10;
/** With `coastal`, open sea far from land counts this much more: a small boat goes round a gulf along the coast
 * (Port-Saint-Louis – Sète – Barcelona, not straight across the Gulf of Lion) unless the detour is very long. */
const COASTAL_COST = 4;
/** Open sea charted shallower than the draft costs this much more instead of being closed: the coarse sea network
 * crosses banks where real boats follow dredged channels (Thames estuary, Wadden sea), so a hard limit would cut
 * whole coasts off. Routes go round shallows where a deeper way exists and report what they could not avoid. */
const SHALLOW_COST = 4; // more would send boats up canals of unknown depth rather than across an estuary
const AVOID_LOCKS_COST = 10;
/** With a departure date, the route is searched again up to this many times, each time also going round the
 *  waterways found closed on the last one: in late summer every canal from the Seine to the Saône (Champagne–
 *  Bourgogne, Briare–Centre, Bourgogne) can be closed in turn. */
const SEASON_ROUNDS = 6;
/** A waterway whose sheet gives a usual maximum draft or lowest bridge the boat exceeds (where OSM records none)
 *  costs this much more: routes go round it where another way exists, and use it, warned, where none does. */
const SHEET_LIMIT_COST = 30;

export const defaultProfile: VesselProfile = {
  speedKmh: 10,
  currentMs: 0.5,
  draft: 1.0,
  airDraft: 3.0,
  beam: 0.5, // a small boat fits everywhere until the user enters theirs
  length: 9,
  lockPenaltyMin: 20,
  avoidLocks: false,
  avoidSea: false,
  coastal: false,
  departure: '',
};

/** Hours underway per day, for dates along a route (as the brief's daily stages). */
export const HOURS_PER_DAY = 8;
/** A waterway usually closed in the month the boat would reach it costs this much more (another way, if any). */
const CLOSED_SEASON_COST = 30;

/** The date (YYYY-MM-DD) after `seconds` underway from `departure`, at HOURS_PER_DAY a day; null without a valid date. */
export function dateAfter(departure: string, seconds: number): string | null {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(departure) ? new Date(`${departure}T12:00:00Z`) : null;
  if (!d || Number.isNaN(d.getTime())) return null;
  d.setUTCDate(d.getUTCDate() + Math.floor(seconds / 3600 / HOURS_PER_DAY));
  return d.toISOString().slice(0, 10);
}

/** The calendar month (1-12) after `seconds` underway from `departure`; null without a date. */
export function monthAfter(departure: string, seconds: number): number | null {
  const d = dateAfter(departure, seconds);
  return d === null ? null : Number(d.slice(5, 7));
}

/** What the router needs from a waterway sheet: where it applies, its current and the months it is usually closed. */
export interface SheetForRouting {
  aliases: string[];
  bbox?: [number, number, number, number];
  current: { typicalMs: number | null };
  months?: { closed: number[] };
  depth?: { maxDraftM: number | null };
  airDraftM?: number | null;
}

export interface Snap {
  geom: number;
  /** index of the segment (points seg..seg+1) */
  seg: number;
  lat: number;
  lon: number;
  /** distance from the requested point to the waterway, m */
  offset: number;
  /** fraction of the geometry's length before the snap point */
  frac: number;
}

export interface RouteEvent {
  type: 'lock';
  name: string;
  lat: number;
  lon: number;
  /** distance from start, m */
  at: number;
}

export interface RouteLeg {
  name: string;
  distance: number;
}

export interface Route {
  coordinates: LngLat[];
  distance: number;
  /** seconds */
  duration: number;
  locks: number;
  /** metres on connections that are not confirmed navigable (manual patches, short connector channels) */
  unverified: number;
  /** metres on open-sea legs */
  sea: number;
  /** metres of open sea with no charted depth (outside the bathymetry's coverage) */
  seaNoDepth: number;
  /** metres of open sea more than 10 km from land */
  offshore: number;
  /** metres travelled with the river current (downstream) and against it (upstream) */
  downstream: number;
  upstream: number;
  /** metres of open sea charted shallower than the vessel's draft that the route could not avoid */
  tooShallow: number;
  /** tightest draft limit on open-sea legs (charted depth minus a margin), m, and where it is; null if none */
  shallowest: { draft: number; at: number } | null;
  events: RouteEvent[];
  legs: RouteLeg[];
  start: Snap;
  end: Snap;
}

export type LimitKind = 'draft' | 'airDraft' | 'beam' | 'length';

/** A mapped limit on the way that the vessel does not fit. */
export interface LimitBreak {
  kind: LimitKind;
  /** the structure's limit, m */
  limit: number;
  /** the vessel's value, m */
  vessel: number;
  name: string;
  /** distance from the start of the route without limits, m */
  at: number;
}

export class RouteError extends Error {
  readonly limits: LimitBreak[];
  constructor(message: string, limits: LimitBreak[] = []) {
    super(message);
    this.limits = limits;
  }
}

const LIMIT_KINDS: LimitKind[] = ['draft', 'airDraft', 'beam', 'length'];
const LIMIT_TEXT: Record<LimitKind, string> = { draft: 'draft', airDraft: 'air draft (headroom)', beam: 'beam', length: 'length' };
const NO_LIMITS = { draft: 0, airDraft: 0, beam: 0, length: 0 };
const NOT_CONNECTED = 'No navigable route found: these points are on waterways that are not connected in the data, '
  + 'or only one way round';

const BLOCKED = Infinity;
/** Alternatives: stretches used by routes found so far cost this much more in the next search... */
const ALT_PENALTY = 1.8;
/** ...and a new route counts when it shares at most this share of its length with them and takes at most this
 * many times the best route's time. */
const ALT_MAX_SHARED = 0.7;
const ALT_MAX_SLOWER = 1.4;

export class Router {
  private index: Flatbush;
  /** edges of the last route built, with where each starts (m): explains a route that limits block */
  private lastPath: { edge: number; at: number }[] = [];
  /** metres along each geometry of the last route built */
  private lastGeoms = new Map<number, number>();
  /** extra cost factor per geometry while searching for alternatives */
  private penalty: Map<number, number> | null = null;
  /** directed edge that runs along geometry g in its stored direction (-1 if none) */
  private geomFwd: Int32Array;
  private geomRev: Int32Array;
  private geomLength: Float64Array;
  private component: Int32Array;
  /** typical current per geometry from the waterway sheets (NaN: the profile's assumed current) */
  private geomCurrent: Float32Array | null = null;
  /** the waterway sheet of each geometry (-1: none), and the sheets' closed months as bit masks (bit 1 = January) */
  private geomSheet: Int32Array | null = null;
  private sheetClosed: number[] = [];
  private sheetDraft: number[] = [];
  private sheetAir: number[] = [];
  /** waterways avoided for the departure date: extra cost per geometry */
  private season: Map<number, number> | null = null;
  readonly names: string[];
  readonly graph: Graph;
  readonly geom: Geometry;

  constructor(graph: Graph, geom: Geometry, names: string[] = []) {
    this.graph = graph;
    this.geom = geom;
    this.names = names;
    const G = geom.geomCount;
    this.geomFwd = new Int32Array(G).fill(-1);
    this.geomRev = new Int32Array(G).fill(-1);
    for (let e = 0; e < graph.edgeCount; e++) {
      const g = graph.edgeGeom[e];
      if (graph.edgeFlags[e] & Flag.GEOM_REVERSED) this.geomRev[g] = e;
      else this.geomFwd[g] = e;
    }
    this.component = components(graph);
    this.geomLength = new Float64Array(G);
    this.index = new Flatbush(Math.max(G, 1), 16, Float32Array);
    for (let g = 0; g < G; g++) {
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, len = 0;
      for (let p = geom.geomOffsets[g]; p < geom.geomOffsets[g + 1]; p++) {
        const lat = geom.lat[p] / COORD_SCALE, lon = geom.lon[p] / COORD_SCALE;
        if (lon < minX) minX = lon;
        if (lon > maxX) maxX = lon;
        if (lat < minY) minY = lat;
        if (lat > maxY) maxY = lat;
        if (p > geom.geomOffsets[g]) len += haversine(geom.lat[p - 1] / COORD_SCALE, geom.lon[p - 1] / COORD_SCALE, lat, lon);
      }
      this.geomLength[g] = len;
      this.index.add(minX, minY, maxX, maxY);
    }
    if (G === 0) this.index.add(0, 0, 0, 0);
    this.index.finish();
  }

  /** Flags shared by both directions of geometry g (direction bits aside). */
  private geomFlags(g: number): number {
    return this.graph.edgeFlags[this.geomEdge(g)];
  }

  /** Whether geometry g is a river drawn downstream (its forward edge runs with the current). */
  private flows(g: number): boolean {
    const f = this.geomFwd[g], r = this.geomRev[g];
    return (f >= 0 && (this.graph.edgeFlags[f] & Flag.DOWNSTREAM) !== 0) || (r >= 0 && (this.graph.edgeFlags[r] & Flag.UPSTREAM) !== 0);
  }

  private geomEdge(g: number): number {
    const f = this.geomFwd[g];
    return f >= 0 ? f : this.geomRev[g];
  }

  /** Draft limit of geometry g when it is open sea, else 0 (unknown or unlimited). */
  private seaDraft(g: number): number {
    const e = this.geomEdge(g);
    return this.graph.edgeFlags[e] & Flag.SEA ? this.graph.attrTable[this.graph.edgeAttr[e] * 4] : 0;
  }

  /** Waterway name of geometry g ('' when unnamed or the name table is missing). */
  nameOf(g: number): string {
    return this.names[this.geom.nameIndex[g]] ?? '';
  }

  private pt(p: number): [number, number] {
    return [this.geom.lat[p] / COORD_SCALE, this.geom.lon[p] / COORD_SCALE];
  }

  /** True if the vessel can travel geometry g in at least one direction. */
  private usable(g: number, p: VesselProfile): boolean {
    const f = this.geomFwd[g], r = this.geomRev[g];
    return (f >= 0 && this.edgeCost(f, p) !== BLOCKED) || (r >= 0 && this.edgeCost(r, p) !== BLOCKED);
  }

  /** Nearest point on any waterway geometry the vessel can use. */
  snap(p: LngLat, profile: VesselProfile = defaultProfile, maxCandidates = 32): Snap | null {
    return this.snapCandidates(p, profile, maxCandidates)[0] ?? null;
  }

  /**
   * The nearest point in each separate part of the network, nearest first. A small isolated fragment next to
   * the start must not hide the connected waterway a little further away.
   */
  snapCandidates([lon, lat]: LngLat, profile: VesselProfile = defaultProfile, maxCandidates = 32): Snap[] {
    if (this.geom.geomCount === 0) return [];
    const candidates = this.index.neighbors(lon, lat, maxCandidates, Infinity, (g) => this.usable(g, profile));
    const bestPer = new Map<number, Snap>();
    for (const g of candidates) {
      const c = this.component[this.geom.geomFrom[g]];
      let best = bestPer.get(c);
      const start = this.geom.geomOffsets[g], end = this.geom.geomOffsets[g + 1];
      let along = 0;
      for (let p = start; p < end - 1; p++) {
        const [aLat, aLon] = this.pt(p), [bLat, bLon] = this.pt(p + 1);
        const segLen = haversine(aLat, aLon, bLat, bLon);
        const pr = projectOnSegment(lat, lon, aLat, aLon, bLat, bLon);
        if (!best || pr.dist < best.offset) {
          const total = this.geomLength[g];
          best = {
            geom: g, seg: p - start, lat: pr.lat, lon: pr.lon, offset: pr.dist,
            frac: total > 0 ? (along + segLen * pr.t) / total : 0,
          };
        }
        along += segLen;
      }
      bestPer.set(c, best!);
    }
    const sorted = [...bestPer.values()].sort((x, y) => x.offset - y.offset);
    // other parts only count when about as close as the nearest one, never a waterway far from the point
    return sorted.filter((s) => s.offset <= sorted[0].offset + ALT_SNAP_M);
  }

  /** Connected part of the network a geometry belongs to. */
  componentOf(s: Snap): number {
    return this.component[this.geom.geomFrom[s.geom]];
  }

  /** Travel time for a directed edge in seconds, or Infinity if the vessel cannot use it. */
  /** Use researched typical currents (m/s, by waterway name) instead of the profile's single assumed current. */
  setCurrents(byName: Map<string, number>): void {
    const byIndex = this.names.map((n) => byName.get(n.trim().toLocaleLowerCase()) ?? NaN);
    this.geomCurrent = Float32Array.from(this.geom.nameIndex, (i) => byIndex[i]); // a missing name becomes NaN
  }

  /** Match each geometry to its waterway sheet (by name, and by the sheet's box where it has one) for currents and
   *  the months the waterway is usually closed. */
  setWaterways(sheets: SheetForRouting[]): void {
    const byName = new Map<string, number[]>();
    sheets.forEach((w, i) => w.aliases.forEach((a) => {
      const k = a.trim().toLocaleLowerCase();
      byName.set(k, [...(byName.get(k) ?? []), i]);
    }));
    const candidates = this.names.map((n) => byName.get(n.trim().toLocaleLowerCase()) ?? []);
    const G = this.geom.geomCount;
    this.geomSheet = new Int32Array(G).fill(-1);
    this.geomCurrent = new Float32Array(G).fill(NaN);
    for (let g = 0; g < G; g++) {
      const cands = candidates[this.geom.nameIndex[g]];
      if (!cands?.length) continue;
      const p = this.geom.geomOffsets[g];
      const lon = this.geom.lon[p] / COORD_SCALE, lat = this.geom.lat[p] / COORD_SCALE;
      const i = cands.find((k) => {
        const b = sheets[k].bbox;
        return !b || (lon >= b[0] && lon <= b[2] && lat >= b[1] && lat <= b[3]);
      });
      if (i === undefined) continue;
      this.geomSheet[g] = i;
      this.geomCurrent[g] = sheets[i].current.typicalMs ?? NaN;
    }
    this.sheetClosed = sheets.map((w) => (w.months?.closed ?? []).reduce((m, k) => m | (1 << k), 0));
    this.sheetDraft = sheets.map((w) => w.depth?.maxDraftM ?? Infinity);
    this.sheetAir = sheets.map((w) => w.airDraftM ?? Infinity);
  }

  private factor(g: number, p: VesselProfile): number {
    const s = this.geomSheet?.[g] ?? -1;
    const over = s >= 0 && (Math.fround(p.draft) > this.sheetDraft[s] || Math.fround(p.airDraft) > this.sheetAir[s]);
    return (this.penalty?.get(g) ?? 1) * (this.season?.get(g) ?? 1) * (over ? SHEET_LIMIT_COST : 1);
  }

  edgeCost(e: number, p: VesselProfile): number {
    const g = this.graph;
    const a = g.edgeAttr[e] * 4;
    const t = g.attrTable;
    const flags = g.edgeFlags[e];
    let shallow = false;
    if (a > 0) {
      // limits are float32: a boat exactly at the mapped limit (2.08 m beam, 2.08 m lock) fits
      const f = Math.fround;
      if (t[a] > 0 && f(p.draft) > t[a]) {
        if (!(flags & Flag.SEA)) return BLOCKED;
        shallow = true;
      }
      if (t[a + 1] > 0 && f(p.airDraft) > t[a + 1]) return BLOCKED;
      if (t[a + 2] > 0 && f(p.beam) > t[a + 2]) return BLOCKED;
      if (t[a + 3] > 0 && f(p.length) > t[a + 3]) return BLOCKED;
    }
    let speed = p.speedKmh / 3.6;
    const known = this.geomCurrent?.[g.edgeGeom[e]];
    const current = known !== undefined && !Number.isNaN(known) ? known : p.currentMs;
    if (flags & Flag.DOWNSTREAM) speed += current;
    else if (flags & Flag.UPSTREAM) speed = Math.max(speed - current, 0.3);
    let cost = g.edgeLength[e] / speed;
    if (flags & Flag.SEA) cost *= (p.avoidSea ? AVOID_SEA_COST : SEA_COST) * (shallow ? SHALLOW_COST : 1);
    if (p.coastal && flags & Flag.OFFSHORE) cost *= COASTAL_COST;
    if (flags & Flag.LOCK) cost += p.lockPenaltyMin * 60 * (p.avoidLocks ? AVOID_LOCKS_COST : 1);
    return this.penalty || this.season || this.geomSheet ? cost * this.factor(g.edgeGeom[e], p) : cost;
  }

  /**
   * Up to `max` other reasonable routes than the best one (by the penalty method): the stretches of the routes
   * found so far cost more, and a route found then counts when it is mostly different and not much slower.
   */
  alternatives(from: LngLat, to: LngLat, profile: VesselProfile = defaultProfile, max = 2): Route[] {
    const best = this.route(from, to, profile);
    const seen = new Map(this.lastGeoms);
    const out: Route[] = [];
    // penalties only make ways costlier, never closed: with a best route, each search finds one
    this.penalty = new Map();
    try {
      for (let tries = 0; tries < max + 2 && out.length < max; tries++) {
        for (const g of seen.keys()) this.penalty.set(g, (this.penalty.get(g) ?? 1) * ALT_PENALTY);
        const r = this.routeFor(from, to, profile);
        if (r.duration > best.duration * ALT_MAX_SLOWER) break;
        let shared = 0;
        for (const [g, m] of this.lastGeoms) if (seen.has(g)) shared += m;
        for (const [g, m] of this.lastGeoms) seen.set(g, m);
        if (shared <= r.distance * ALT_MAX_SHARED) out.push(r);
      }
    } finally {
      this.penalty = null;
    }
    return out;
  }

  route(from: LngLat, to: LngLat, profile: VesselProfile = defaultProfile): Route {
    this.season = null;
    try {
      let r = this.routeFor(from, to, profile);
      // with a departure date: go round waterways usually closed in the month the boat reaches them, where possible
      for (let round = 0; round < SEASON_ROUNDS; round++) {
        const closed = this.closedOnArrival(r, profile);
        if (!closed.size) break;
        this.season ??= new Map();
        for (let g = 0; g < this.geom.geomCount; g++) if (closed.has(this.geomSheet![g])) this.season.set(g, CLOSED_SEASON_COST);
        r = this.routeFor(from, to, profile);
      }
      return r;
    } catch (e) {
      throw this.explain(from, to, profile, e as RouteError);
    }
  }

  /** The sheets of waterways on the last route that are usually closed in the month the boat would reach them. */
  private closedOnArrival(r: Route, profile: VesselProfile): Set<number> {
    const out = new Set<number>();
    if (!this.geomSheet || !profile.departure || r.distance <= 0) return out;
    const speed = r.distance / Math.max(r.duration, 1);
    let at = 0;
    for (const [g, metres] of this.lastGeoms) {
      const sheet = this.geomSheet[g];
      const month = monthAfter(profile.departure, at / speed);
      if (sheet >= 0 && month !== null && this.sheetClosed[sheet] & (1 << month) && !this.season?.has(g)) out.add(sheet);
      at += metres;
    }
    return out;
  }

  /** Why there is no route: the limits the vessel breaks on the way it would take without them, or no way at all. */
  private explain(from: LngLat, to: LngLat, profile: VesselProfile, error: RouteError): RouteError {
    if (this.geom.geomCount === 0) return error;
    if (Object.entries(NO_LIMITS).every(([k, v]) => profile[k as LimitKind] === v)) return new RouteError(NOT_CONNECTED);
    try {
      this.routeFor(from, to, { ...profile, ...NO_LIMITS });
    } catch {
      return new RouteError(NOT_CONNECTED);
    }
    const tightest = new Map<LimitKind, LimitBreak>();
    for (const { edge, at } of this.lastPath) {
      const a = this.graph.edgeAttr[edge] * 4; // row 0 holds no limits
      LIMIT_KINDS.forEach((kind, i) => {
        const limit = this.graph.attrTable[a + i];
        if (limit <= 0 || Math.fround(profile[kind]) <= limit) return;
        if (kind === 'draft' && this.graph.edgeFlags[edge] & Flag.SEA) return; // shallow sea costs more, never blocks
        if ((tightest.get(kind)?.limit ?? Infinity) <= limit) return;
        const g = this.graph.edgeGeom[edge];
        const name = this.nameOf(g) || (this.graph.edgeFlags[edge] & Flag.LOCK ? 'A lock' : 'An unnamed stretch');
        tightest.set(kind, { kind, limit: Math.round(limit * 100) / 100, vessel: profile[kind], name, at });
      });
    }
    const limits = [...tightest.values()].sort((x, y) => x.at - y.at); // in the order they come
    const text = limits.map((l) =>
      `${l.name} (km ${(l.at / 1000).toFixed(0)}) limits ${LIMIT_TEXT[l.kind]} to ${l.limit} m, yours is ${l.vessel} m`);
    return new RouteError(`No route for this vessel: ${text.join('; ')}. Change the vessel settings if your boat fits.`, limits);
  }

  private routeFor(from: LngLat, to: LngLat, profile: VesselProfile): Route {
    const ss = this.snapCandidates(from, profile), ts = this.snapCandidates(to, profile);
    if (!ss.length || !ts.length) throw new RouteError('No waterway data loaded');
    // start and end must lie in the same connected part; prefer the pair closest to the requested points
    const pairs = ss.flatMap((s) => ts.filter((t) => this.componentOf(t) === this.componentOf(s)).map((t) => [s, t] as const))
      .sort((x, y) => x[0].offset + x[1].offset - (y[0].offset + y[1].offset));
    let error = new RouteError('No navigable route found between these points for this vessel');
    for (const [s, t] of pairs) {
      try {
        return this.routeBetween(s, t, profile);
      } catch (e) {
        error = e as RouteError; // e.g. a one-way stretch the other way round: try the next pair
      }
    }
    throw error;
  }

  /** A route through waypoints in order: from, ...via, to. */
  routeVia(points: LngLat[], profile: VesselProfile = defaultProfile): Route {
    if (points.length < 2) throw new RouteError('A route needs a start and an end');
    // each leg sets off when the one before ends, so its waterways are checked for the right month
    const parts: Route[] = [];
    let elapsed = 0;
    for (const [i, p] of points.slice(1).entries()) {
      const departure = profile.departure ? dateAfter(profile.departure, elapsed) ?? '' : '';
      const r = this.route(points[i], p, { ...profile, departure });
      parts.push(r);
      elapsed += r.duration;
    }
    return parts.reduce(joinRoutes);
  }

  routeBetween(s: Snap, t: Snap, profile: VesselProfile): Route {
    const { graph } = this;
    const N = graph.nodeCount;
    const SRC = N, DST = N + 1;
    const cost = new Float64Array(N + 2).fill(Infinity);
    /** edge used to reach node; -2 = from source along snapped geom, -1 = none */
    const prevEdge = new Int32Array(N + 2).fill(-1);
    const prevNode = new Int32Array(N + 2).fill(-1);
    const done = new Uint8Array(N + 2);
    const heap = new MinHeap();
    const maxSpeed = profile.speedKmh / 3.6 + profile.currentMs;
    const h = (n: number) =>
      n === DST ? 0 : haversine(graph.nodeLat[n] / COORD_SCALE, graph.nodeLon[n] / COORD_SCALE, t.lat, t.lon) / maxSpeed;

    // Partial edges from the start snap to the two ends of its geometry.
    const sFwd = this.geomFwd[s.geom], sRev = this.geomRev[s.geom];
    const relax = (node: number, c: number, viaEdge: number, viaNode: number) => {
      if (c < cost[node]) {
        cost[node] = c;
        prevEdge[node] = viaEdge;
        prevNode[node] = viaNode;
        heap.push(node, c + h(node));
      }
    };
    cost[SRC] = 0;
    if (sFwd >= 0) relax(this.geom.geomTo[s.geom], this.edgeCost(sFwd, profile) * (1 - s.frac), -2, SRC);
    if (sRev >= 0) relax(this.geom.geomFrom[s.geom], this.edgeCost(sRev, profile) * s.frac, -2, SRC);

    // Same geometry: direct travel between the two snaps.
    if (s.geom === t.geom) {
      const forward = t.frac >= s.frac;
      const e = forward ? sFwd : sRev;
      if (e >= 0) relax(DST, this.edgeCost(e, profile) * Math.abs(t.frac - s.frac), -2, SRC);
    }

    const tFwd = this.geomFwd[t.geom], tRev = this.geomRev[t.geom];
    const tFrom = this.geom.geomFrom[t.geom], tTo = this.geom.geomTo[t.geom];

    while (heap.size > 0) {
      const u = heap.pop();
      if (done[u]) continue;
      done[u] = 1;
      if (u === DST) break;
      const cu = cost[u];
      // Final partial edge into the target snap.
      if (u === tFrom && tFwd >= 0) relax(DST, cu + this.edgeCost(tFwd, profile) * t.frac, tFwd, u);
      if (u === tTo && tRev >= 0) relax(DST, cu + this.edgeCost(tRev, profile) * (1 - t.frac), tRev, u);
      for (let e = graph.edgeOffsets[u]; e < graph.edgeOffsets[u + 1]; e++) {
        const v = graph.edgeTarget[e];
        if (done[v]) continue;
        const c = this.edgeCost(e, profile);
        if (c === BLOCKED) continue;
        relax(v, cu + c, e, u);
      }
    }

    if (!Number.isFinite(cost[DST])) {
      throw new RouteError('No navigable route found between these points for this vessel');
    }
    const route = this.buildRoute(s, t, prevEdge, prevNode, cost[DST], profile);
    // the search cost includes routing penalties; report the time actually underway
    const seaFactor = profile.avoidSea ? AVOID_SEA_COST : SEA_COST;
    route.duration -= ((seaFactor - 1) * route.sea + seaFactor * (SHALLOW_COST - 1) * route.tooShallow
      + (profile.coastal ? seaFactor * (COASTAL_COST - 1) * route.offshore : 0)) / (profile.speedKmh / 3.6)
      + (profile.avoidLocks ? (AVOID_LOCKS_COST - 1) * profile.lockPenaltyMin * 60 * route.locks : 0);
    return route;
  }

  private buildRoute(s: Snap, t: Snap, prevEdge: Int32Array, prevNode: Int32Array, duration: number, profile: VesselProfile): Route {
    const vesselDraft = profile.draft;
    // searching for alternatives, the cost carries their penalties: the time is summed from the stretches instead
    const penalty = this.penalty || this.season || this.geomSheet;
    let unpenalized = 0;
    const N = this.graph.nodeCount;
    const SRC = N, DST = N + 1;
    // Walk back from target to source.
    const chain: { node: number; edge: number }[] = [];
    for (let n = DST; n !== SRC; n = prevNode[n]) chain.push({ node: n, edge: prevEdge[n] });
    chain.reverse();

    const coords: LngLat[] = [[s.lon, s.lat]];
    const events: RouteEvent[] = [];
    const legs: RouteLeg[] = [];
    let distance = 0, locks = 0, unverified = 0, sea = 0, seaNoDepth = 0, offshore = 0, tooShallow = 0, downstream = 0, upstream = 0;
    let shallowest: Route['shallowest'] = null;
    const push = (lat: number, lon: number) => {
      const last = coords[coords.length - 1];
      if (last[0] === lon && last[1] === lat) return;
      distance += haversine(last[1], last[0], lat, lon);
      coords.push([lon, lat]);
    };
    const addLeg = (g: number, before: number) => {
      const name = this.nameOf(g) || (this.geomFlags(g) & Flag.SEA ? 'Open sea' : '');
      const d = distance - before;
      const last = legs[legs.length - 1];
      // Unnamed pieces (river areas, connectors) are folded into the previous named leg.
      if (last && (last.name === name || name === '')) last.distance += d;
      else if (last && last.name === '') {
        last.name = name;
        last.distance += d;
      }
      else legs.push({ name, distance: d });
    };

    this.lastPath = [];
    this.lastGeoms = new Map();
    for (const { node, edge } of chain) {
      const before = distance;
      let current = 0; // +1 with the river current, -1 against it
      let travelled = -1; // the directed edge this stretch runs along
      let g: number;
      if (edge === -2) {
        // Leaving the start snap along its geometry, possibly straight to the target on the same geometry.
        g = s.geom;
        this.lastPath.push({ edge: this.geomEdge(g), at: before });
        const endSeg = node === DST ? t.seg : null;
        const toEnd = node === DST ? t.frac >= s.frac : node === this.geom.geomTo[g];
        travelled = toEnd ? this.geomFwd[g] : this.geomRev[g];
        this.walk(g, s.seg, toEnd, endSeg, push);
        if (node === DST) push(t.lat, t.lon);
        if (this.flows(g)) current = toEnd ? 1 : -1;
      } else {
        g = this.graph.edgeGeom[edge];
        travelled = edge;
        this.lastPath.push({ edge, at: before });
        const f = this.graph.edgeFlags[edge];
        if (f & Flag.DOWNSTREAM) current = 1;
        else if (f & Flag.UPSTREAM) current = -1;
        const reversed = (this.graph.edgeFlags[edge] & Flag.GEOM_REVERSED) !== 0;
        if (node === DST) {
          // Enter the target geometry from one end and stop at the snap.
          this.walkFromEnd(g, reversed, t.seg, push);
          push(t.lat, t.lon);
        } else {
          this.walkFromEnd(g, reversed, null, push);
        }
        if (this.graph.edgeFlags[edge] & Flag.LOCK) {
          locks++;
          const [lon, lat] = coords[coords.length - 1];
          events.push({ type: 'lock', name: this.nameOf(g) || 'Lock', lat, lon, at: distance });
        }
      }
      addLeg(g, before);
      this.lastGeoms.set(g, (this.lastGeoms.get(g) ?? 0) + distance - before);
      if (penalty && distance > before) {
        // the search moves along a geometry only where an edge runs that way, so `travelled` is set
        const e = travelled;
        unpenalized += (this.edgeCost(e, profile) / this.factor(g, profile)) * ((distance - before) / this.graph.edgeLength[e]);
      }
      if (this.geomFlags(g) & Flag.PATCH) unverified += distance - before;
      if (this.geomFlags(g) & Flag.SEA) sea += distance - before;
      if (this.geomFlags(g) & Flag.NO_DEPTH) seaNoDepth += distance - before;
      if (this.geomFlags(g) & Flag.OFFSHORE) offshore += distance - before;
      if (current > 0) downstream += distance - before;
      else if (current < 0) upstream += distance - before;
      const draft = distance > before ? this.seaDraft(g) : 0; // a snap at the very end of a stretch does not cross it
      if (draft > 0 && (!shallowest || draft < shallowest.draft)) shallowest = { draft: Math.round(draft * 100) / 100, at: before };
      if (draft > 0 && vesselDraft > draft) tooShallow += distance - before;
    }
    if (penalty) duration = unpenalized;
    return { coordinates: coords, distance, duration, locks, unverified, sea, seaNoDepth, offshore, downstream, upstream, tooShallow, shallowest, events, legs: legs.filter((l) => l.distance > 1), start: s, end: t };
  }

  /** From inside segment `seg` of geometry g walk to its end (toEnd) or start, stopping at segment endSeg if given. */
  private walk(g: number, seg: number, toEnd: boolean, endSeg: number | null, push: (lat: number, lon: number) => void) {
    const start = this.geom.geomOffsets[g], end = this.geom.geomOffsets[g + 1];
    if (toEnd) {
      const last = endSeg === null ? end - 1 : start + endSeg;
      for (let p = start + seg + 1; p <= last; p++) push(...this.pt(p));
    } else {
      const last = endSeg === null ? start : start + endSeg + 1;
      for (let p = start + seg; p >= last; p--) push(...this.pt(p));
    }
  }

  /** Walk geometry g from one end (start if !reversed, else end), up to and including segment `untilSeg`'s near point. */
  private walkFromEnd(g: number, reversed: boolean, untilSeg: number | null, push: (lat: number, lon: number) => void) {
    const start = this.geom.geomOffsets[g], end = this.geom.geomOffsets[g + 1];
    if (!reversed) {
      const last = untilSeg === null ? end - 1 : start + untilSeg;
      for (let p = start; p <= last; p++) push(...this.pt(p));
    } else {
      const last = untilSeg === null ? start : start + untilSeg + 1;
      for (let p = end - 1; p >= last; p--) push(...this.pt(p));
    }
  }
}

/** How much further than the nearest waterway a snap in another part of the network may lie. */
export const ALT_SNAP_M = 1000;

/** Connected component of every node (edges taken as undirected). */
function components(g: Graph): Int32Array {
  const parent = Int32Array.from({ length: g.nodeCount }, (_, i) => i);
  const find = (x: number): number => {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]];
      x = parent[x];
    }
    return x;
  };
  for (let u = 0; u < g.nodeCount; u++) {
    for (let e = g.edgeOffsets[u]; e < g.edgeOffsets[u + 1]; e++) parent[find(u)] = find(g.edgeTarget[e]);
  }
  return parent.map((_, i) => find(i));
}

/** Route a followed by route b (b starts where a ends, at the waypoint). */
export function joinRoutes(a: Route, b: Route): Route {
  const legs = a.legs.map((l) => ({ ...l }));
  for (const l of b.legs) {
    const last = legs[legs.length - 1];
    if (last && last.name === l.name) last.distance += l.distance;
    else legs.push({ ...l });
  }
  return {
    coordinates: [...a.coordinates, ...b.coordinates.slice(1)],
    distance: a.distance + b.distance,
    duration: a.duration + b.duration,
    locks: a.locks + b.locks,
    unverified: a.unverified + b.unverified,
    sea: a.sea + b.sea,
    seaNoDepth: a.seaNoDepth + b.seaNoDepth,
    offshore: a.offshore + b.offshore,
    downstream: a.downstream + b.downstream,
    upstream: a.upstream + b.upstream,
    tooShallow: a.tooShallow + b.tooShallow,
    shallowest: [a.shallowest, b.shallowest && { ...b.shallowest, at: b.shallowest.at + a.distance }]
      .filter((x) => x !== null).sort((x, y) => x.draft - y.draft)[0] ?? null,
    events: [...a.events, ...b.events.map((e) => ({ ...e, at: e.at + a.distance }))],
    legs,
    start: a.start,
    end: b.end,
  };
}
