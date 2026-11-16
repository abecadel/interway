import { describe, expect, it } from 'vitest';
import { buildGraph } from './builder';
import { decodeGeometry, decodeGraph, encodeGeometry, encodeGraph } from './format';

const { graph, geometry } = buildGraph([
  { points: [[17, 51], [17.1, 51]], name: 'A', kind: 'river', limits: [2, 3, 4, 5] },
  { points: [[17.1, 51], [17.2, 51]], name: 'A', kind: 'sea', oneway: true, limits: [1, 1, 1, 1] },
  { points: [[17.2, 51], [17.3, 51]], kind: 'lake', lock: true },
]);

describe('graph format', () => {
  it('round-trips every array', () => {
    const g = decodeGraph(encodeGraph(graph));
    for (const k of Object.keys(graph) as (keyof typeof graph)[]) {
      const v = graph[k];
      expect(typeof v === 'number' ? g[k] : Array.from(g[k] as ArrayLike<number>)).toEqual(
        typeof v === 'number' ? v : Array.from(v as ArrayLike<number>),
      );
    }
    const s = decodeGeometry(encodeGeometry(geometry));
    expect(Array.from(s.geomOffsets)).toEqual(Array.from(geometry.geomOffsets));
    expect(Array.from(s.lon)).toEqual(Array.from(geometry.lon));
  });

  it('builder reuses names and keeps one row per limits', () => {
    expect(geometry.nameIndex[0]).toBe(geometry.nameIndex[1]);
    expect(graph.attrTable.length / 4).toBe(3);
    expect(graph.edgeCount).toBe(5); // one-way segment has a single edge
  });

  it('rejects bad magic, version and truncated files', () => {
    expect(() => decodeGraph(new ArrayBuffer(32))).toThrow(/magic/);
    const buf = encodeGraph(graph);
    const wrongVersion = buf.slice(0);
    new DataView(wrongVersion).setUint32(4, 2, true);
    expect(() => decodeGraph(wrongVersion)).toThrow(/version 2/);
    expect(() => decodeGraph(buf.slice(0, 40))).toThrow(/truncated/);
  });
});
