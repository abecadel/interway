import { describe, expect, it } from 'vitest';
import { buildGraph, type SegmentInput } from '../graph/builder';
import { decodeGeometry, decodeGraph, encodeGeometry, encodeGraph, Flag, type Geometry, type Graph } from '../graph/format';
import { defaultProfile, Router, RouteError } from './router';

// A small network:  A ──river── B ──canal(lock)── C
//                                 └──long river── D ── C
const A: [number, number] = [17.0, 51.0];
const B: [number, number] = [17.1, 51.0];
const C: [number, number] = [17.2, 51.0];
const D: [number, number] = [17.15, 51.1];

const segments: SegmentInput[] = [
  { points: [A, [17.05, 51.001], B], name: 'Odra', kind: 'river' },
  { points: [B, C], name: 'Kanał', kind: 'canal', lock: true, limits: [2.0, 4.0, 0, 0] },
  { points: [B, D], name: 'Long way', kind: 'river' },
  { points: [D, C], name: 'Long way', kind: 'river' },
];

function makeRouter(segs = segments) {
  const { graph, geometry, names } = buildGraph(segs);
  // Round-trip through the binary format so the router is tested on decoded data.
  return new Router(decodeGraph(encodeGraph(graph)), decodeGeometry(encodeGeometry(geometry)), names);
}

describe('graph format', () => {
  it('round-trips graph and geometry', () => {
    const { graph, geometry } = buildGraph(segments);
    const g2 = decodeGraph(encodeGraph(graph));
    const s2 = decodeGeometry(encodeGeometry(geometry));
    expect(Array.from(g2.edgeTarget)).toEqual(Array.from(graph.edgeTarget));
    expect(Array.from(g2.edgeFlags)).toEqual(Array.from(graph.edgeFlags));
    expect(Array.from(g2.attrTable)).toEqual(Array.from(graph.attrTable));
    expect(Array.from(s2.lat)).toEqual(Array.from(geometry.lat));
    expect(Array.from(s2.nameIndex)).toEqual(Array.from(geometry.nameIndex));
  });

  it('rejects wrong magic', () => {
    expect(() => decodeGraph(new ArrayBuffer(32))).toThrow(/magic/);
  });
});

describe('router', () => {
  it('snaps to the nearest waterway', () => {
    const r = makeRouter();
    const s = r.snap([17.05, 51.01])!;
    expect(r.names[r.geom.nameIndex[s.geom]]).toBe('Odra');
    expect(s.offset).toBeGreaterThan(900);
    expect(s.offset).toBeLessThan(1200);
  });

  it('takes the short canal with a lock', () => {
    const r = makeRouter();
    const route = r.route([17.02, 51.0], [17.18, 51.0]);
    expect(route.locks).toBe(1);
    expect(route.legs.map((l) => l.name)).toEqual(['Odra', 'Kanał']);
    expect(route.distance).toBeGreaterThan(10_000);
    expect(route.distance).toBeLessThan(13_000);
    expect(route.coordinates[0][0]).toBeCloseTo(17.02, 3);
    expect(route.coordinates.at(-1)![0]).toBeCloseTo(17.18, 3);
  });

  it('avoids the canal when the bridge is too low', () => {
    const r = makeRouter();
    const route = r.route([17.02, 51.0], [17.18, 51.0], { ...defaultProfile, airDraft: 5 });
    expect(route.locks).toBe(0);
    expect(route.legs.map((l) => l.name)).toEqual(['Odra', 'Long way']);
  });

  it('is slower upstream than downstream', () => {
    const r = makeRouter();
    const down = r.route([17.01, 51.0], [17.09, 51.0]);
    const up = r.route([17.09, 51.0], [17.01, 51.0]);
    expect(up.duration).toBeGreaterThan(down.duration);
    expect(up.distance).toBeCloseTo(down.distance, 0);
  });

  it('routes within one segment', () => {
    const r = makeRouter();
    const route = r.route([17.11, 51.0], [17.19, 51.0]);
    expect(route.distance).toBeGreaterThan(5000);
    expect(route.distance).toBeLessThan(6000);
  });

  it('respects one-way segments', () => {
    const r = makeRouter([{ points: [A, B], oneway: true }]);
    expect(r.route(A, B).distance).toBeGreaterThan(6000);
    expect(() => r.route(B, [17.01, 51.0])).toThrow(RouteError);
  });

  it('fails between disconnected waterways', () => {
    const r = makeRouter([{ points: [A, B] }, { points: [C, [17.3, 51.0]] }]);
    expect(() => r.route(A, C)).toThrow(RouteError);
  });
});

describe('router edge cases', () => {
  it('blocks edges by draft, beam and length limits', () => {
    const limited = (limits: [number, number, number, number]) => makeRouter([{ points: [A, B], limits }]);
    expect(() => limited([0.5, 0, 0, 0]).route(A, B)).toThrow(/limits draft to 0.5 m, yours is 1 m/);
    expect(() => limited([0, 0, 2, 0]).route(A, B, { ...defaultProfile, beam: 3 })).toThrow(/limits beam to 2 m, yours is 3 m/);
    expect(limited([0, 0, 2, 0]).route(A, B).distance).toBeGreaterThan(6000); // the 0.5 m default fits
    expect(() => limited([0, 0, 0, 5]).route(A, B)).toThrow(/limits length to 5 m, yours is 9 m/);
    expect(limited([5, 10, 10, 50]).route(A, B).distance).toBeGreaterThan(6000);
    // a narrowboat exactly at a 2.08 m lock limit (stored as float32 2.0799999) fits
    expect(limited([0, 0, 2.08, 0]).route(A, B, { ...defaultProfile, beam: 2.08 }).distance).toBeGreaterThan(6000);
    expect(() => limited([0, 0, 2.08, 0]).route(A, B, { ...defaultProfile, beam: 2.09 })).toThrow(RouteError);
  });

  it('explains a failed route by the limits on the way the vessel would otherwise take', () => {
    const r = makeRouter([
      { points: [A, B], name: 'Hurleston Lock 1', lock: true, limits: [0, 0, 2.08, 0] },
      { points: [B, C], limits: [0, 1.83, 2.5, 0] }, // an unnamed tunnel, wider than the lock
      { points: [C, D], limits: [0, 2.5, 0, 0] },
      { points: [D, [17.3, 51.2]], kind: 'sea', limits: [1, 2.0, 0, 0] }, // a low bridge; shallow sea never blocks
    ]);
    let err: RouteError | undefined;
    try {
      r.route([17.01, 51.0], [17.29, 51.19], { ...defaultProfile, draft: 2, beam: 3 });
      expect.unreachable();
    } catch (e) {
      err = e as RouteError;
    }
    expect(err!.message).toMatch(/^No route for this vessel: Hurleston Lock 1 \(km 0\) limits beam to 2.08 m, yours is 3 m; /);
    expect(err!.message).toMatch(/An unnamed stretch \(km \d+\) limits air draft \(headroom\) to 1.83 m, yours is 3 m\. Change/);
    expect(err!.limits.map((l) => [l.kind, l.limit])).toEqual([['beam', 2.08], ['airDraft', 1.83]]);
    // an unnamed lock is named as one
    const lock = makeRouter([{ points: [A, B], lock: true, limits: [0, 0, 2, 0] }]);
    expect(() => lock.route(A, B, { ...defaultProfile, beam: 3 })).toThrow(/^No route for this vessel: A lock/);
  });

  it('says when the points are simply not connected', () => {
    const r = makeRouter([{ points: [A, B], limits: [0, 0, 5, 0] }, { points: [C, [17.3, 51.0]] }]);
    expect(() => r.route(A, C)).toThrow(/not connected in the data/);
    // a vessel without any limits set gets the same answer at once
    expect(() => r.route(A, C, { ...defaultProfile, draft: 0, airDraft: 0, beam: 0, length: 0 })).toThrow(/not connected/);
  });

  it('avoid-locks multiplies the lock penalty', () => {
    const r = makeRouter([...segments, { points: [C, [17.3, 51.0]], name: 'Beyond' }]);
    const normal = r.route([17.02, 51.0], [17.25, 51.0]);
    expect(normal.locks).toBe(1);
    const avoid = r.route([17.02, 51.0], [17.25, 51.0], { ...defaultProfile, avoidLocks: true });
    expect(avoid.locks).toBe(0);
    expect(avoid.duration).toBeGreaterThan(normal.duration);
  });

  it('reports the shallowest open-sea stretch, also across waypoints', () => {
    // three sea stretches with charted-depth draft limits 6, 2.5 and none; a river with its own draft limit
    const r = makeRouter([
      { points: [A, B], kind: 'river', limits: [1.5, 0, 0, 0] },
      { points: [B, C], kind: 'sea', limits: [6, 0, 0, 0] },
      { points: [C, D], kind: 'sea', limits: [2.5, 0, 0, 0] },
      { points: [D, [17.3, 51.2]], kind: 'sea' },
    ]);
    const route = r.route([17.01, 51.0], [17.25, 51.15]);
    expect(route.shallowest!.draft).toBeCloseTo(2.5, 5); // the river's 1.5 m is not sea
    expect(route.shallowest!.at).toBeCloseTo(13_300, -2);
    expect(r.route([17.01, 51.0], [17.09, 51.0]).shallowest).toBeNull();
    const via = r.routeVia([[17.01, 51.0], [17.15, 51.0], [17.25, 51.15]]);
    expect(via.shallowest!.draft).toBeCloseTo(2.5, 5);
    expect(via.shallowest!.at).toBeGreaterThan(12_000);
    expect(r.routeVia([[17.25, 51.15], [17.17, 51.07], [17.01, 51.0]]).shallowest!.draft).toBeCloseTo(2.5, 5);
  });

  it('goes round sea charted too shallow for the draft, and crosses it when there is no other way', () => {
    // P -> Q: a direct 14 km sea stretch over a bank (2 m), or a deeper sea way round, about 20% longer
    const P: [number, number] = [17.0, 51.0], Q: [number, number] = [17.2, 51.0];
    const bank = { points: [P, Q], kind: 'sea' as const, limits: [2, 0, 0, 0] as [number, number, number, number] };
    const r = makeRouter([bank, { points: [P, [17.1, 51.06], Q], kind: 'sea' }]);
    expect(r.route(P, Q).distance).toBeLessThan(15_000); // 1 m draft: over the bank
    const deep = r.route(P, Q, { ...defaultProfile, draft: 3 });
    expect(deep.distance).toBeGreaterThan(15_000);
    expect(deep.tooShallow).toBe(0);
    expect(deep.shallowest).toBeNull();
    // only the bank: the route still crosses it, says so, and reports real time
    const only = makeRouter([bank]).route([17.001, 51.0], [17.199, 51.0], { ...defaultProfile, draft: 3 });
    expect(only.tooShallow).toBeCloseTo(only.distance, -2);
    expect(only.shallowest!.draft).toBe(2);
    expect(only.duration).toBeCloseTo(only.distance / (defaultProfile.speedKmh / 3.6), 0);
    expect(makeRouter([bank]).routeVia([[17.001, 51.0], [17.1, 51.0], [17.199, 51.0]], { ...defaultProfile, draft: 3 }).tooShallow)
      .toBeCloseTo(only.tooShallow, -2);
  });

  it('prefers a comparable inland way to the open sea, and reports real time', () => {
    // P -> Q: 14 km of sea, or an inland canal 20% longer
    const P: [number, number] = [17.0, 51.0], Q: [number, number] = [17.2, 51.0];
    const r = makeRouter([
      { points: [P, Q], kind: 'sea' },
      { points: [P, [17.1, 51.06], Q], name: 'Kanał', kind: 'canal' },
    ]);
    const inland = r.route(P, Q);
    expect(inland.sea).toBe(0);
    expect(inland.legs.map((l) => l.name)).toEqual(['Kanał']);
    // without the inland way the sea is used, and its time is distance / speed, not the penalised cost
    const seaOnly = makeRouter([{ points: [P, Q], kind: 'sea' }]).route([17.001, 51.0], [17.199, 51.0]);
    expect(seaOnly.sea).toBeCloseTo(seaOnly.distance, 0);
    expect(seaOnly.duration).toBeCloseTo(seaOnly.distance / (defaultProfile.speedKmh / 3.6), 0);
    const avoiding = makeRouter([{ points: [P, Q], kind: 'sea' }]).route([17.001, 51.0], [17.199, 51.0], { ...defaultProfile, avoidSea: true });
    expect(avoiding.duration).toBeCloseTo(seaOnly.duration, 0);
    // avoiding locks does not add the extra penalty to the reported time
    const locked = makeRouter([{ points: [A, B] }, { points: [B, C], lock: true }, { points: [C, [17.3, 51.0]] }]);
    const normal = locked.route([17.05, 51.0], [17.25, 51.0]);
    expect(normal.locks).toBe(1);
    expect(locked.route([17.05, 51.0], [17.25, 51.0], { ...defaultProfile, avoidLocks: true }).duration).toBeCloseTo(normal.duration, 0);
  });

  it('never goes slower than the upstream floor speed', () => {
    const r = makeRouter([{ points: [A, B], kind: 'river' }]);
    const p = { ...defaultProfile, speedKmh: 1, currentMs: 5 };
    const up = r.route([17.09, 51.0], [17.01, 51.0], p);
    expect(up.duration).toBeCloseTo(up.distance / 0.3, -1);
  });

  it('returns null snaps and an error without geometry', () => {
    const r = makeRouter([]);
    expect(r.snap(A)).toBeNull();
    expect(() => r.route(A, B)).toThrow('No waterway data loaded');
  });

  it('routes backwards within one geometry', () => {
    const r = makeRouter([{ points: [A, [17.05, 51.0], B, [17.15, 51.0]] }]);
    const route = r.route([17.12, 51.0], [17.03, 51.0]);
    expect(route.distance).toBeCloseTo(6300, -2);
    expect(route.coordinates.map((c) => c[0])).toEqual([17.12, 17.1, 17.05, 17.03].map((x) => expect.closeTo(x, 4)));
  });

  it('enters the target geometry from its far end', () => {
    // target on segment drawn C->B, approached from B, i.e. against the drawing direction
    const r = makeRouter([{ points: [A, B], name: 'one' }, { points: [C, [17.15, 51.0], B], name: 'two' }]);
    const route = r.route([17.02, 51.0], [17.18, 51.0]);
    expect(route.legs.map((l) => l.name)).toEqual(['one', 'two']);
    expect(route.coordinates.at(-1)![0]).toBeCloseTo(17.18, 4);
  });

  it('names unnamed locks and folds unnamed legs', () => {
    const { graph, geometry } = buildGraph([
      { points: [A, B] },
      { points: [B, C], lock: true, name: 'Kanał' },
      { points: [C, D] },
    ]);
    const r = new Router(graph, geometry); // no name table at all
    const route = r.route([17.01, 51.0], [17.17, 51.07]);
    expect(route.events[0].name).toBe('Lock');
    expect(route.legs).toHaveLength(1);
    const named = new Router(graph, geometry, ['', 'Kanał']);
    expect(named.route([17.01, 51.0], [17.17, 51.07]).legs.map((l) => l.name)).toEqual(['Kanał']);
  });

  it('travels full geometries against their drawing direction', () => {
    const r = makeRouter([...segments, { points: [C, [17.3, 51.0]], name: 'Beyond' }]);
    const route = r.route([17.25, 51.0], [17.02, 51.0]);
    expect(route.legs.map((l) => l.name)).toEqual(['Beyond', 'Kanał', 'Odra']);
    expect(route.coordinates[1][0]).toBeCloseTo(17.2, 6);
  });

  it('skips an isolated fragment nearer than the connected network', () => {
    // a short ditch right next to the start, not connected to anything; the river is a little further away
    const r = makeRouter([{ points: [A, C], name: 'river' }, { points: [[17.0, 51.002], [17.01, 51.002]], name: 'ditch' }]);
    expect(r.snap([17.005, 51.0015])!.geom).toBe(1);
    const route = r.route([17.005, 51.0015], [17.15, 51.0]);
    expect(route.legs.map((l) => l.name)).toEqual(['river']);
    expect(r.snapCandidates([17.005, 51.0015])).toHaveLength(2);
  });

  it('tries the next pair when the closest one has no way through', () => {
    // two parallel one-way-like stretches: the closest pair fails, the next one works
    const graph: Graph = {
      nodeCount: 4, edgeCount: 2,
      nodeLat: Int32Array.from([51e7, 51e7, 51.001e7, 51.001e7]), nodeLon: Int32Array.from([17e7, 17.1e7, 17e7, 17.1e7]),
      edgeOffsets: Uint32Array.from([0, 0, 1, 2, 2]), edgeTarget: Uint32Array.from([0, 3]), edgeLength: Float32Array.from([7000, 7000]),
      edgeGeom: Uint32Array.from([0, 1]), edgeAttr: Uint16Array.from([0, 0]),
      edgeFlags: Uint16Array.from([Flag.GEOM_REVERSED, 0]), attrTable: new Float32Array(4),
    };
    const geometry: Geometry = {
      geomCount: 2, geomFrom: Uint32Array.from([0, 2]), geomTo: Uint32Array.from([1, 3]), geomOffsets: Uint32Array.from([0, 2, 4]),
      lat: Int32Array.from([51e7, 51e7, 51.001e7, 51.001e7]), lon: Int32Array.from([17e7, 17.1e7, 17e7, 17.1e7]),
      nameIndex: Uint32Array.from([0, 0]),
    };
    const r = new Router(graph, geometry);
    // nearer to the B->A stretch, but heading east only works on the other one
    const route = r.route([17.02, 51.0002], [17.08, 51.0002]);
    expect(route.coordinates[0][1]).toBeCloseTo(51.001, 5);
  });

  it('counts and names open-sea legs', () => {
    const r = makeRouter([
      { points: [A, B], name: 'Wisła', kind: 'river' },
      { points: [B, C], kind: 'sea' },
      { points: [C, D], name: 'Fairway', kind: 'sea' },
    ]);
    const route = r.route([17.01, 51.0], [17.16, 51.08]);
    expect(route.legs.map((l) => l.name)).toEqual(['Wisła', 'Open sea', 'Fairway']);
    expect(route.sea).toBeCloseTo(route.legs[1].distance + route.legs[2].distance, 0);
    expect(r.route([17.01, 51.0], [17.05, 51.0]).sea).toBe(0);
  });

  it('routes through waypoints', () => {
    const r = makeRouter([...segments, { points: [C, [17.3, 51.0]], name: 'Beyond' }]);
    const direct = r.route([17.02, 51.0], [17.25, 51.0]);
    const via = r.routeVia([[17.02, 51.0], [17.15, 51.1], [17.25, 51.0]]);
    expect(via.distance).toBeGreaterThan(direct.distance);
    expect(via.locks).toBe(0); // the detour via D avoids the lock canal
    expect(via.legs.map((l) => l.name)).toEqual(['Odra', 'Long way', 'Beyond']);
    expect(via.start).toEqual(direct.start);
    expect(via.coordinates.at(-1)![0]).toBeCloseTo(17.25, 4);
    // lock events of the second part are offset by the first part's length
    const out = r.route([17.25, 51.0], [17.02, 51.0]), ret = r.route([17.02, 51.0], [17.25, 51.0]);
    const back = r.routeVia([[17.25, 51.0], [17.02, 51.0], [17.25, 51.0]]);
    expect(back.events.map((e) => e.at)).toEqual([out.events[0].at, out.distance + ret.events[0].at]);
    expect(() => r.routeVia([[17.02, 51.0]])).toThrow('A route needs a start and an end');
  });

  it('snaps to zero-length geometries', () => {
    const r = makeRouter([{ points: [A, A] }]);
    expect(r.snap([17.0, 51.01])!.frac).toBe(0);
  });

  it('skips stale heap entries when a node is improved later', () => {
    // X lies towards the target so it is expanded first, but X->T is a long detour; the better way
    // P->Y->T improves T later, leaving a stale heap entry that is popped before the far-away target.
    const P: [number, number] = [17.0, 51.0], X: [number, number] = [17.02, 51.0], Y: [number, number] = [17.0, 51.01];
    const T: [number, number] = [17.05, 51.0];
    const r = makeRouter([
      { points: [P, X] }, { points: [X, [17.02, 51.05], [17.05, 51.05], T] }, { points: [P, Y] }, { points: [Y, T] },
      // winding tail: the real remaining distance is far longer than the straight-line heuristic
      { points: [T, [17.05, 51.3], [17.1, 51.3], [17.1, 51.0]] },
    ]);
    const route = r.route([16.999, 51.0], [17.1, 51.01]);
    expect(route.legs).toHaveLength(1);
    expect(route.distance).toBeGreaterThan(60_000);
    expect(route.coordinates.some(([lon, lat]) => lon === 17.0 && lat === 51.01)).toBe(true); // went via Y
  });

  it('handles geometries that only have a reverse edge', () => {
    // geometry drawn A->B, but the only edge runs B->A
    const graph: Graph = {
      nodeCount: 2, edgeCount: 1,
      nodeLat: Int32Array.from([A[1] * 1e7, B[1] * 1e7]), nodeLon: Int32Array.from([A[0] * 1e7, B[0] * 1e7]),
      edgeOffsets: Uint32Array.from([0, 0, 1]), edgeTarget: Uint32Array.from([0]), edgeLength: Float32Array.from([7000]),
      edgeGeom: Uint32Array.from([0]), edgeAttr: Uint16Array.from([0]), edgeFlags: Uint16Array.from([Flag.GEOM_REVERSED]),
      attrTable: new Float32Array(4),
    };
    const geometry: Geometry = {
      geomCount: 1, geomFrom: Uint32Array.from([0]), geomTo: Uint32Array.from([1]), geomOffsets: Uint32Array.from([0, 2]),
      lat: Int32Array.from([A[1] * 1e7, B[1] * 1e7]), lon: Int32Array.from([A[0] * 1e7, B[0] * 1e7]), nameIndex: Uint32Array.from([0]),
    };
    const r = new Router(graph, geometry);
    expect(r.route([17.08, 51.0], [17.02, 51.0]).distance).toBeCloseTo(4200, -2);
    expect(() => r.route([17.02, 51.0], [17.08, 51.0])).toThrow(RouteError);
  });

  it('measures distance on unverified connections', () => {
    const r = makeRouter([{ points: [A, B], name: 'river' }, { points: [B, C], kind: 'patch' }]);
    const route = r.route([17.05, 51.0], [17.15, 51.0]);
    expect(route.unverified).toBeCloseTo(3500, -2);
    expect(r.route([17.01, 51.0], [17.09, 51.0]).unverified).toBe(0);
  });
});
