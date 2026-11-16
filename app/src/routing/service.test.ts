import { describe, expect, it, vi } from 'vitest';
import { buildGraph } from '../graph/builder';
import { encodeGeometry, encodeGraph } from '../graph/format';
import { defaultProfile } from './router';
import { networkGeoJson, RoutingService } from './service';

const { graph, geometry, names } = buildGraph([
  { points: [[17, 51], [17.1, 51]], name: 'Odra' },
  { points: [[17.1, 51], [17.2, 51]] },
]);
const manifest = { version: 1, region: 'test', files: { graph: 'g.bin', geom: 's.bin' }, names, attribution: 'x' };

function server(overrides: Record<string, Response> = {}) {
  const files: Record<string, () => Response> = {
    '/d/manifest.json': () => new Response(JSON.stringify(manifest)),
    '/d/g.bin': () => new Response(encodeGraph(graph)),
    '/d/s.bin': () => new Response(encodeGeometry(geometry)),
  };
  return vi.fn(async (url: string) => overrides[url] ?? files[url]?.() ?? new Response('', { status: 404 }));
}

describe('RoutingService', () => {
  it('loads data with or without a trailing slash and routes', async () => {
    for (const base of ['/d', '/d/']) {
      const svc = new RoutingService(server());
      const loaded = await svc.respond({ id: 1, type: 'load', baseUrl: base });
      expect(loaded).toMatchObject({ id: 1, ok: true, result: { nodes: 3, edges: 4, manifest: { region: 'test' } } });
    }
    const svc = new RoutingService(server());
    await svc.handle({ id: 1, type: 'load', baseUrl: '/d' });
    const route = await svc.respond({ id: 2, type: 'route', from: [17.01, 51], to: [17.19, 51], profile: defaultProfile });
    expect(route.ok && (route.result as { legs: unknown[] }).legs).toEqual([expect.objectContaining({ name: 'Odra' })]);
    const net = await svc.respond({ id: 3, type: 'network' });
    expect(net).toMatchObject({ ok: true, result: { type: 'FeatureCollection', features: [{}, {}] } });
  });

  it('reports a missing manifest and missing binaries', async () => {
    const noManifest = new RoutingService(server({ '/d/manifest.json': new Response('', { status: 404 }) }));
    expect(await noManifest.respond({ id: 1, type: 'load', baseUrl: '/d' })).toEqual({
      id: 1, ok: false, error: expect.stringMatching(/manifest.json missing/),
    });
    const noGraph = new RoutingService(server({ '/d/g.bin': new Response('', { status: 500 }) }));
    expect(await noGraph.respond({ id: 2, type: 'load', baseUrl: '/d' })).toEqual({ id: 2, ok: false, error: '/d/g.bin: HTTP 500' });
  });

  it('refuses to route or list before loading', async () => {
    const svc = new RoutingService(server());
    for (const msg of [{ id: 1, type: 'network' as const }, { id: 1, type: 'route' as const, from: [0, 0] as [number, number], to: [0, 0] as [number, number], profile: defaultProfile }]) {
      expect(await svc.respond(msg)).toEqual({ id: 1, ok: false, error: 'Waterway data not loaded yet' });
    }
  });

  it('turns non-Error throws into messages', async () => {
    const svc = new RoutingService(async () => { throw 'boom'; });
    expect(await svc.respond({ id: 9, type: 'load', baseUrl: '/' })).toEqual({ id: 9, ok: false, error: 'boom' });
  });

  it('uses the global fetch by default', async () => {
    const fetchMock = server();
    vi.stubGlobal('fetch', fetchMock);
    await new RoutingService().handle({ id: 1, type: 'load', baseUrl: '/d' });
    expect(fetchMock).toHaveBeenCalledWith('/d/manifest.json');
    vi.unstubAllGlobals();
  });

  it('network features carry names', async () => {
    const svc = new RoutingService(server());
    await svc.handle({ id: 1, type: 'load', baseUrl: '/d' });
    const fc = networkGeoJson(svc.router!);
    expect(fc.features.map((f) => f.properties!.name)).toEqual(['Odra', '']);
    expect(fc.features[0].geometry).toEqual({ type: 'LineString', coordinates: [[17, 51], [17.1, 51]] });
  });
});
