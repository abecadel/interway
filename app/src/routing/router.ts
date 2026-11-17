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
}

export const defaultProfile: VesselProfile = {
  speedKmh: 10,
  currentMs: 0.5,
  draft: 1.0,
  airDraft: 3.0,
  beam: 3.0,
  length: 9,
  lockPenaltyMin: 20,
  avoidLocks: false,
};

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
  events: RouteEvent[];
  legs: RouteLeg[];
  start: Snap;
  end: Snap;
}

export class RouteError extends Error {}

const BLOCKED = Infinity;

export class Router {
  private index: Flatbush;
  /** directed edge that runs along geometry g in its stored direction (-1 if none) */
  private geomFwd: Int32Array;
  private geomRev: Int32Array;
  private geomLength: Float64Array;
  private component: Int32Array;
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
    const f = this.geomFwd[g];
    return this.graph.edgeFlags[f >= 0 ? f : this.geomRev[g]];
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
  edgeCost(e: number, p: VesselProfile): number {
    const g = this.graph;
    const a = g.edgeAttr[e] * 4;
    const t = g.attrTable;
    if (a > 0) {
      if (t[a] > 0 && p.draft > t[a]) return BLOCKED;
      if (t[a + 1] > 0 && p.airDraft > t[a + 1]) return BLOCKED;
      if (t[a + 2] > 0 && p.beam > t[a + 2]) return BLOCKED;
      if (t[a + 3] > 0 && p.length > t[a + 3]) return BLOCKED;
    }
    const flags = g.edgeFlags[e];
    let speed = p.speedKmh / 3.6;
    if (flags & Flag.DOWNSTREAM) speed += p.currentMs;
    else if (flags & Flag.UPSTREAM) speed = Math.max(speed - p.currentMs, 0.3);
    let cost = g.edgeLength[e] / speed;
    if (flags & Flag.LOCK) cost += p.lockPenaltyMin * 60 * (p.avoidLocks ? 10 : 1);
    return cost;
  }

  route(from: LngLat, to: LngLat, profile: VesselProfile = defaultProfile): Route {
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
    return this.buildRoute(s, t, prevEdge, prevNode, cost[DST]);
  }

  private buildRoute(s: Snap, t: Snap, prevEdge: Int32Array, prevNode: Int32Array, duration: number): Route {
    const N = this.graph.nodeCount;
    const SRC = N, DST = N + 1;
    // Walk back from target to source.
    const chain: { node: number; edge: number }[] = [];
    for (let n = DST; n !== SRC; n = prevNode[n]) chain.push({ node: n, edge: prevEdge[n] });
    chain.reverse();

    const coords: LngLat[] = [[s.lon, s.lat]];
    const events: RouteEvent[] = [];
    const legs: RouteLeg[] = [];
    let distance = 0, locks = 0, unverified = 0, sea = 0;
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

    for (const { node, edge } of chain) {
      const before = distance;
      let g: number;
      if (edge === -2) {
        // Leaving the start snap along its geometry, possibly straight to the target on the same geometry.
        g = s.geom;
        const endSeg = node === DST ? t.seg : null;
        const toEnd = node === DST ? t.frac >= s.frac : node === this.geom.geomTo[g];
        this.walk(g, s.seg, toEnd, endSeg, push);
        if (node === DST) push(t.lat, t.lon);
      } else {
        g = this.graph.edgeGeom[edge];
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
      if (this.geomFlags(g) & Flag.PATCH) unverified += distance - before;
      if (this.geomFlags(g) & Flag.SEA) sea += distance - before;
    }
    return { coordinates: coords, distance, duration, locks, unverified, sea, events, legs: legs.filter((l) => l.distance > 1), start: s, end: t };
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
