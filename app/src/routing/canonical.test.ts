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
}

const dataDir = process.env.INTERWAY_DATA;
const routes = parse(readFileSync(join(import.meta.dirname, '../../../data/test-routes.yaml'), 'utf8')) as TestRoute[];
const only = process.env.INTERWAY_ROUTES?.split(',');

const buf = (p: string) => {
  const b = readFileSync(p);
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

describe.skipIf(!dataDir || !existsSync(join(dataDir, 'manifest.json')))('canonical routes', () => {
  const manifest = JSON.parse(readFileSync(join(dataDir!, 'manifest.json'), 'utf8'));
  const router = new Router(decodeGraph(buf(join(dataDir!, 'graph.bin'))), decodeGeometry(buf(join(dataDir!, 'geom.bin'))), manifest.names);

  for (const r of routes.filter((r) => !only || only.some((o: string) => r.name.includes(o)))) {
    it(r.name, () => {
      const route = router.route(r.from, r.to);
      const km = route.distance / 1000;
      console.log(`${r.name}: ${km.toFixed(0)} km, ${route.locks} locks, snap ${route.start.offset.toFixed(0)}/${route.end.offset.toFixed(0)} m`);
      console.log('  via ' + route.legs.filter((l) => l.distance > 2000).map((l) => `${l.name || '?'} ${(l.distance / 1000).toFixed(0)}`).join(' → '));
      expect(route.start.offset).toBeLessThan(3000);
      expect(route.end.offset).toBeLessThan(3000);
      expect(Math.abs(km - r.expected_km) / r.expected_km).toBeLessThan(r.tolerance);
    });
  }
});
