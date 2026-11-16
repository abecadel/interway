import { afterEach, describe, expect, it, vi } from 'vitest';
import { searchPlaces } from './search';

const feature = (props: Record<string, string>, coords = [21, 52]) => ({
  type: 'Feature', properties: props, geometry: { type: 'Point', coordinates: coords },
});

afterEach(() => vi.unstubAllGlobals());

describe('searchPlaces', () => {
  it('queries Photon and builds labels', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({
      type: 'FeatureCollection',
      features: [feature({ name: 'Giżycko', city: 'Giżycko', country: 'Polska' }), feature({ name: 'Marina', city: 'Pisz', country: 'Polska' })],
    })));
    vi.stubGlobal('fetch', fetchMock);
    const r = await searchPlaces('giz', [21.7, 54]);
    expect(r.map((p) => p.label)).toEqual(['Giżycko, Polska', 'Marina, Pisz, Polska']);
    expect(r[0].position).toEqual([21, 52]);
    const url = new URL(String((fetchMock.mock.calls[0] as unknown[])[0]));
    expect(url.searchParams.get('lat')).toBe('54');
    expect(url.searchParams.get('q')).toBe('giz');
  });

  it('omits location bias without a position', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ type: 'FeatureCollection', features: [] })));
    vi.stubGlobal('fetch', fetchMock);
    expect(await searchPlaces('x')).toEqual([]);
    expect(String((fetchMock.mock.calls[0] as unknown[])[0])).not.toContain('lat=');
  });

  it('throws on HTTP errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 503 })));
    await expect(searchPlaces('x')).rejects.toThrow('HTTP 503');
  });
});
