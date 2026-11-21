// A tiny data pack (graph.bin, geom.bin, manifest.json, pois.json) for the route service's tests.
import { buildGraph } from '../graph/builder';
import { encodeGeometry, encodeGraph } from '../graph/format';
import type { ReadFile } from '../service/engine';

const { graph, geometry, names } = buildGraph([
  { points: [[17.0, 51.0], [17.1, 51.0]], name: 'Odra', kind: 'river' },
  { points: [[17.1, 51.0], [17.2, 51.0]], name: 'Kanał', kind: 'canal', lock: true },
  { points: [[17.2, 51.0], [17.3, 51.0]], name: 'Odra', kind: 'river' },
]);

export const pois = [
  { type: 'place', name: 'Startowo', lat: 51.0, lon: 17.0, cc: 'PL' },
  { type: 'marina', name: 'Przystań Środek', lat: 51.0, lon: 17.15 },
  { type: 'place', name: 'Metowo', lat: 51.0, lon: 17.3, cc: 'PL' },
];

const text = (s: string) => new TextEncoder().encode(s).buffer as ArrayBuffer;

export function fixtureFiles(over: Record<string, unknown> = {}): Record<string, ArrayBuffer> {
  const manifest = { version: 1, region: 'Test', files: { graph: 'graph.bin', geom: 'geom.bin', pois: 'pois.json' }, names, attribution: '',
    sha256: { graph: 'abcdef0123456789' }, ...over };
  return { 'manifest.json': text(JSON.stringify(manifest)), 'graph.bin': encodeGraph(graph), 'geom.bin': encodeGeometry(geometry), 'pois.json': text(JSON.stringify(pois)) };
}

export const fixtureReader = (files = fixtureFiles()): ReadFile => async (name) => {
  if (!(name in files)) throw new Error(`no ${name}`);
  return files[name];
};
