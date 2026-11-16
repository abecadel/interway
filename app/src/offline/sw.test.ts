import { describe, expect, it, vi } from 'vitest';

type Listener = (ev: unknown) => void;

describe('service worker entry', () => {
  it('wires install, activate and fetch', async () => {
    const listeners: Record<string, Listener> = {};
    const scope = {
      addEventListener: (type: string, fn: Listener) => { listeners[type] = fn; },
      skipWaiting: vi.fn(async () => {}),
      clients: { claim: vi.fn(async () => {}) },
      caches: { keys: async () => ['interway-app-v0'], delete: vi.fn(async () => true), open: vi.fn() },
      location: { origin: 'https://interway.example' },
    };
    vi.stubGlobal('self', scope);
    vi.stubGlobal('fetch', vi.fn(async () => new Response('net')));
    await import('./sw');

    listeners.install({});
    expect(scope.skipWaiting).toHaveBeenCalled();

    let activated: Promise<unknown> | undefined;
    listeners.activate({ waitUntil: (p: Promise<unknown>) => { activated = p; } });
    await activated;
    expect(scope.caches.delete).toHaveBeenCalledWith('interway-app-v0');
    expect(scope.clients.claim).toHaveBeenCalled();

    const bypass = { request: new Request('https://photon.komoot.io/api/'), respondWith: vi.fn() };
    listeners.fetch(bypass);
    expect(bypass.respondWith).not.toHaveBeenCalled();

    const cache = { match: async () => undefined, put: vi.fn(async () => {}), keys: async () => [], delete: async () => true };
    scope.caches.open.mockResolvedValue(cache);
    let response: Promise<Response> | undefined;
    const waits: Promise<unknown>[] = [];
    listeners.fetch({
      request: new Request('https://tiles.openseamap.org/seamark/1/1/1.png'),
      respondWith: (p: Promise<Response>) => { response = p; },
      waitUntil: (p: Promise<unknown>) => waits.push(p),
    });
    expect(await (await response!).text()).toBe('net');
    await Promise.all(waits);
    expect(cache.put).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
