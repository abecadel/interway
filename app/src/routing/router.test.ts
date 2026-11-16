import { describe, expect, it } from 'vitest';
import { buildGraph, type SegmentInput } from '../graph/builder';
import { decodeGeometry, decodeGraph, encodeGeometry, encodeGraph } from '../graph/format';
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
