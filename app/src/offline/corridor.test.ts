import { describe, expect, it, vi } from 'vitest';
import type { LngLat } from '../graph/geo';
import { clearSaved, ROUTE_CACHE, corridorTiles, corridorUrls, corridorZoom, MAX_ZOOM, saveUrls, SEAMARK_TILES, STYLE_URL } from './corridor';
import { CACHES } from './strategy';

// about 7 km along a parallel at 52 N
const line: LngLat[] = [[21, 52], [21.1, 52]];

describe('corridorTiles', () => {
  it('covers the line and its buffer at every zoom, more tiles deeper', () => {
    const tiles = corridorTiles(line, 8, 14);
    const at = (z: number) => tiles.filter((t) => t.startsWith(`${z}/`));
    expect(at(8)).toEqual(['8/142/84', '8/143/84']);
    expect(at(14).length).toBeGreaterThan(at(12).length);
    // the line's middle, 1 km south of it and 1 km north are all covered at z14
    const x = Math.floor(((21.05 + 180) / 360) * 2 ** 14);
    const y = (lat: number) => {
      const r = (lat * Math.PI) / 180;
      return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** 14);
    };
    for (const lat of [52, 51.991, 52.009]) expect(tiles).toContain(`14/${x}/${y(lat)}`);
    expect(tiles).not.toContain(`14/${x}/${y(52.03)}`);
    expect(corridorTiles([[21, 52]], 10, 10)).toHaveLength(1);
  });

  it('chooses the deepest zoom that keeps a route within the limit', () => {
    expect(corridorZoom(line)).toBe(MAX_ZOOM);
    expect(corridorZoom([[0, 45], [20, 45], [20, 46], [0, 46]])).toBe(13); // 3000 km
    expect(corridorZoom([[-10, 35], [30, 70], [-10, 35], [30, 36]])).toBe(12);
    // back and forth across Europe 15 times: not even z11 fits
    const sweeps = Array.from({ length: 15 }, (_, i): LngLat[] => [[-10, 35 + i / 2], [30, 35 + i / 2]]).flat();
    expect(corridorZoom(sweeps)).toBeNull();
  });
});

describe('corridorUrls', () => {
  it('lists the style, tile sources, seamarks, sprites and fonts', async () => {
    const style = {
      sources: {
        relief: { tiles: ['https://t.example/relief/{z}/{x}/{y}.png'], maxzoom: 6 },
        vector: { url: 'https://t.example/planet' },
        other: { url: 'https://t.example/other', maxzoom: 10 },
        raster: { tiles: ['https://t.example/r/{z}/{x}/{y}.png'] },
        empty: { tiles: [] },
      },
      glyphs: 'https://t.example/fonts/{fontstack}/{range}.pbf',
      sprite: 'https://t.example/sprites/ofm',
      layers: [{ layout: { 'text-font': ['Noto Sans Regular'] } }, { layout: {} }, {}],
    };
    const fetchFn = vi.fn(async (u: string) => new Response(JSON.stringify(
      u === STYLE_URL ? style
        : u.endsWith('/other') ? { tiles: ['https://t.example/other/{z}/{x}/{y}.pbf'] } // no maxzoom: the style's
          : { tiles: ['https://t.example/planet/v1/{z}/{x}/{y}.pbf'], maxzoom: 14 },
    ))) as unknown as typeof fetch;
    const urls = await corridorUrls(line, 12, fetchFn);
    expect(urls[0]).toBe(STYLE_URL);
    expect(urls).toContain('https://t.example/planet');
    expect(urls).toContain('https://t.example/planet/v1/8/142/84.pbf');
    expect(urls).toContain('https://t.example/r/8/142/84.png');
    expect(urls.some((u) => u.includes('/relief/'))).toBe(false);
    expect(urls.some((u) => u.includes('/13/'))).toBe(false);
    expect(urls.some((u) => u.startsWith('https://t.example/other/10/'))).toBe(true);
    expect(urls.some((u) => u.startsWith('https://t.example/other/11/'))).toBe(false);
    expect(urls).toContain(SEAMARK_TILES.replace('{z}/{x}/{y}', '9/285/169'));
    expect(urls).toContain('https://t.example/sprites/ofm@2x.png');
    expect(urls).toContain('https://t.example/fonts/Noto%20Sans%20Regular/256-511.pbf');
    // a style without sprite or glyphs
    const bare = vi.fn(async () => new Response(JSON.stringify({ sources: {}, layers: [] }))) as unknown as typeof fetch;
    expect((await corridorUrls(line, 9, bare)).filter((u) => !u.includes('seamark'))).toEqual([STYLE_URL]);
  });
});

function memCaches() {
  const stores = new Map<string, Map<string, Response>>();
  return {
    stores,
    storage: {
      open: async (name: string) => {
        if (!stores.has(name)) stores.set(name, new Map());
        const m = stores.get(name)!;
        return { match: async (u: string) => m.get(u), put: async (u: string, r: Response) => { m.set(u, r); } };
      },
      delete: async (name: string) => stores.delete(name),
    } as unknown as CacheStorage,
  };
}

describe('saveUrls', () => {
  it('uses the cache the service worker serves saved maps from', () => {
    expect(ROUTE_CACHE).toBe(CACHES.route);
  });

  it('fetches into the saved-maps cache, skipping saved ones and counting failures', async () => {
    const { stores, storage } = memCaches();
    (await storage.open(CACHES.route)).put('u0', new Response('old'));
    const fetchFn = vi.fn(async (u: string) => {
      if (u === 'u3') throw new Error('offline');
      return new Response('x', { status: u === 'u2' ? 404 : 200 });
    }) as unknown as typeof fetch;
    const progress = vi.fn();
    const r = await saveUrls(['u0', 'u1', 'u2', 'u3', 'u4'], progress, undefined, fetchFn, storage);
    expect(r).toEqual({ saved: 3, failed: 2 });
    expect(fetchFn).toHaveBeenCalledTimes(4);
    expect([...stores.get(CACHES.route)!.keys()].sort()).toEqual(['u0', 'u1', 'u4']);
    expect(progress).toHaveBeenLastCalledWith(5, 5);
    expect(await clearSaved(storage)).toBe(true);
    expect(stores.has(CACHES.route)).toBe(false);
  });

  it('stops when cancelled', async () => {
    const { storage } = memCaches();
    const ctrl = new AbortController();
    ctrl.abort();
    const r = await saveUrls(['a', 'b'], () => {}, ctrl.signal, vi.fn() as unknown as typeof fetch, storage);
    expect(r).toEqual({ saved: 0, failed: 0 });
  });
});
