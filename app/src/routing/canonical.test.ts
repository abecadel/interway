// Checks the canonical routes in data/test-routes.yaml against a built data directory.
// Run: INTERWAY_DATA=path/to/out npx vitest run src/routing/canonical.test.ts
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { decodeGeometry, decodeGraph } from '../graph/format';
import type { LngLat } from '../graph/geo';
import { Router } from './router';

interface TestRoute {
  name: string;
  from: LngLat;
  to: LngLat;
  expected_km: number;
  tolerance: number;
  countries: string[];
  via?: string[];
  min_locks?: number;
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
  const wanted = (r: TestRoute) => (only ? only.some((o: string) => r.name.includes(o)) : r.countries.every((c) => covered.has(c)));

  for (const r of routes) {
    it.skipIf(!wanted(r))(r.name, () => {
      const route = router.route(r.from, r.to);
      const km = route.distance / 1000;
      console.log(`${r.name}: ${km.toFixed(0)} km, ${route.locks} locks, snap ${route.start.offset.toFixed(0)}/${route.end.offset.toFixed(0)} m`);
      console.log('  via ' + route.legs.filter((l) => l.distance > 2000).map((l) => `${l.name || '?'} ${(l.distance / 1000).toFixed(0)}`).join(' → '));
      expect(route.start.offset).toBeLessThan(3000);
      expect(route.end.offset).toBeLessThan(3000);
      expect(Math.abs(km - r.expected_km) / r.expected_km).toBeLessThan(r.tolerance);
      const names = route.legs.map((l) => l.name.toLowerCase());
      for (const v of r.via ?? []) expect(names.some((n) => n.includes(v.toLowerCase())), `via ${v}`).toBe(true);
      if (r.min_locks !== undefined) expect(route.locks).toBeGreaterThanOrEqual(r.min_locks);
    });
  }
});
