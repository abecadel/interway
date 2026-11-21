// Checks the canonical routes in data/test-routes.yaml against a built data directory.
// Run: INTERWAY_DATA=path/to/out npx vitest run src/routing/canonical.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { decodeGeometry, decodeGraph } from '../graph/format';
import type { LngLat } from '../graph/geo';
import { defaultProfile, Router, type VesselProfile } from './router';

interface TestRoute {
  name: string;
  from: LngLat;
  to: LngLat;
  // points the described voyage passes, when it is not the shortest way (routed leg by leg)
  waypoints?: LngLat[];
  expected_km?: number;
  tolerance?: number;
  sea?: boolean;
  countries: string[];
  via?: string[];
  min_locks?: number;
  // at most this much on the sea mesh ("Open sea" legs), e.g. 0 for a lagoon the coastline leaves open
  max_sea_km?: number;
  // boat for the route when the default (3 m beam) does not fit, e.g. a narrowboat on the English narrow canals
  vessel?: Partial<VesselProfile>;
  // a known gap in the data that makes this route fail today (expected to fail: when it passes, remove the gap)
  known_gap?: string;
  source: string;
}

const dataDir = process.env.INTERWAY_DATA ?? '';
const routes = parse(readFileSync(join(import.meta.dirname, '../../../data/test-routes.yaml'), 'utf8')) as TestRoute[];
const only = process.env.INTERWAY_ROUTES?.split(',');

const buf = (p: string) => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe('canonical routes', () => {
  if (!existsSync(join(dataDir, 'manifest.json'))) throw new Error(`INTERWAY_DATA must point to a built data directory (got '${dataDir}')`);
  const manifest = JSON.parse(readFileSync(join(dataDir, 'manifest.json'), 'utf8'));
  const router = new Router(decodeGraph(buf(join(dataDir, 'graph.bin'))), decodeGeometry(buf(join(dataDir, 'geom.bin'))), manifest.names);

  // Data built from whole countries lists them; partial (demo) data runs only routes picked by INTERWAY_ROUTES.
  const covered = new Set<string>(manifest.countries ?? []);
  const wanted = (r: TestRoute) =>
    only ? only.some((o: string) => r.name.includes(o)) : r.countries.every((c) => covered.has(c)) && (!r.sea || manifest.sea === true);

  for (const r of routes) {
    const test = !wanted(r) ? it.skip : r.known_gap ? it.fails : it;
    test(r.known_gap ? `${r.name} [known gap: ${r.known_gap}]` : r.name, () => {
      const pts = [r.from, ...(r.waypoints ?? []), r.to];
      const profile = { ...defaultProfile, ...r.vessel };
      const parts = pts.slice(1).map((p, i) => router.route(pts[i], p, profile));
      for (const part of parts) {
        expect(part.start.offset).toBeLessThan(3000);
        expect(part.end.offset).toBeLessThan(3000);
      }
      const route = {
        distance: parts.reduce((a, p) => a + p.distance, 0),
        locks: parts.reduce((a, p) => a + p.locks, 0),
        legs: parts.flatMap((p) => p.legs),
        sea: parts.reduce((a, p) => a + p.sea, 0),
      };
      const km = route.distance / 1000;
      console.log(`${r.name}: ${km.toFixed(0)} km, ${route.locks} locks`);
      console.log('  via ' + route.legs.filter((l) => l.distance > 2000).map((l) => `${l.name || '?'} ${(l.distance / 1000).toFixed(0)}`).join(' → '));
      if (r.expected_km !== undefined) expect(Math.abs(km - r.expected_km) / r.expected_km).toBeLessThan(r.tolerance ?? 0.15);
      const names = route.legs.map((l) => l.name.toLowerCase());
      for (const v of r.via ?? []) expect(names.some((n) => n.includes(v.toLowerCase())), `via ${v}`).toBe(true);
      if (r.min_locks !== undefined) expect(route.locks).toBeGreaterThanOrEqual(r.min_locks);
      if (r.max_sea_km !== undefined) expect(route.sea / 1000, 'km on open sea').toBeLessThanOrEqual(r.max_sea_km);
    });
  }
});
