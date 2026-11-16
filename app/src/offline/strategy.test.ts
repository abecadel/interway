import { describe, expect, it, vi } from 'vitest';
import { CACHES, cleanup, handleFetch, shouldHandle, strategyFor, trim, type CacheLike, type CacheStorageLike } from './strategy';

const ORIGIN = 'https://interway.example';

class MemCache implements CacheLike {
  store = new Map<string, Response>();
  async match(req: Request) { return this.store.get(req.url)?.clone(); }
  async put(req: Request, res: Response) { this.store.set(req.url, res); }
  async keys() { return [...this.store.keys()].map((u) => new Request(u)); }
  async delete(req: Request) { return this.store.delete(req.url); }
}

class MemStorage implements CacheStorageLike {
  caches = new Map<string, MemCache>();
  async open(name: string) {
    if (!this.caches.has(name)) this.caches.set(name, new MemCache());
    return this.caches.get(name)!;
  }
  async keys() { return [...this.caches.keys()]; }
  async delete(name: string) { return this.caches.delete(name); }
}

const ok = (body: string) => new Response(body, { status: 200 });
const req = (u: string, method = 'GET') => new Request(u.startsWith('http') ? u : ORIGIN + u, { method });

function setup(fetchImpl: (r: Request) => Promise<Response>) {
  const storage = new MemStorage();
  const waits: Promise<unknown>[] = [];
  const fetchFn = vi.fn(fetchImpl);
  const run = (r: Request) => handleFetch(r, ORIGIN, storage, fetchFn, (p) => waits.push(p));
  return { storage, waits, fetchFn, run };
}

describe('strategyFor / shouldHandle', () => {
  it('classifies requests', () => {
    expect(strategyFor(new URL('https://tiles.openfreemap.org/x.pbf'), ORIGIN)).toBe('tiles');
    expect(strategyFor(new URL('https://tiles.openseamap.org/seamark/1/2/3.png'), ORIGIN)).toBe('tiles');
    expect(strategyFor(new URL('https://photon.komoot.io/api/?q=x'), ORIGIN)).toBe('bypass');
    expect(strategyFor(new URL(ORIGIN + '/data/graph.bin'), ORIGIN)).toBe('data');
    expect(strategyFor(new URL(ORIGIN + '/assets/index.js'), ORIGIN)).toBe('app');
  });

  it('only handles GET requests it caches', () => {
    expect(shouldHandle(req('/'), ORIGIN)).toBe(true);
    expect(shouldHandle(req('/', 'POST'), ORIGIN)).toBe(false);
    expect(shouldHandle(req('https://photon.komoot.io/api/'), ORIGIN)).toBe(false);
  });
});

describe('handleFetch', () => {
  it('app: network first, cache when offline, error when never cached', async () => {
    let online = true;
    const { run, storage } = setup(async () => { if (!online) throw new Error('offline'); return ok('v1'); });
    expect(await (await run(req('/index.html'))).text()).toBe('v1');
    online = false;
    expect(await (await run(req('/index.html'))).text()).toBe('v1');
    await expect(run(req('/other.js'))).rejects.toThrow('offline');
    expect((await storage.open(CACHES.app)).store.size).toBe(1);
  });

  it('app: does not cache errors', async () => {
    const { run, storage } = setup(async () => new Response('nope', { status: 500 }));
    expect((await run(req('/x'))).status).toBe(500);
    expect((await storage.open(CACHES.app)).store.size).toBe(0);
  });

  it('data: serves the cached copy and refreshes it in the background', async () => {
    let version = 'old';
    let fail = false;
    const { run, waits, fetchFn } = setup(async () => {
      if (fail) throw new Error('offline');
      return version === 'bad' ? new Response('', { status: 404 }) : ok(version);
    });
    expect(await (await run(req('/data/graph.bin'))).text()).toBe('old'); // first load from network
    version = 'new';
    expect(await (await run(req('/data/graph.bin'))).text()).toBe('old'); // cached, refresh started
    await Promise.all(waits);
    expect(await (await run(req('/data/graph.bin'))).text()).toBe('new');
    version = 'bad';
    await run(req('/data/graph.bin'));
    await Promise.all(waits);
    fail = true;
    expect(await (await run(req('/data/graph.bin'))).text()).toBe('new'); // 404 not cached, offline ignored
    await Promise.all(waits);
    expect(fetchFn).toHaveBeenCalledTimes(5);
  });

  it('tiles: cache first and trimmed to the limit', async () => {
    const { run, waits, fetchFn, storage } = setup(async (r) => (r.url.endsWith('404.png') ? new Response('', { status: 404 }) : ok(r.url)));
    const url = 'https://tiles.openseamap.org/seamark/1/1/1.png';
    await run(req(url));
    expect(await (await run(req(url))).text()).toBe(url);
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect((await run(req('https://tiles.openseamap.org/404.png'))).status).toBe(404);
    await Promise.all(waits);
    expect((await storage.open(CACHES.tiles)).store.size).toBe(1);
  });
});

describe('trim and cleanup', () => {
  it('drops the oldest entries over the limit', async () => {
    const c = new MemCache();
    for (const n of ['a', 'b', 'c']) await c.put(req('/' + n), ok(n));
    expect(await trim(c, 5)).toBe(0);
    expect(await trim(c, 2)).toBe(1);
    expect([...c.store.keys()]).toEqual([ORIGIN + '/b', ORIGIN + '/c']);
  });

  it('removes caches of older app versions only', async () => {
    const s = new MemStorage();
    for (const name of ['interway-app-v0', CACHES.app, 'someone-else']) await s.open(name);
    expect(await cleanup(s)).toEqual(['interway-app-v0']);
    expect(await s.keys()).toEqual([CACHES.app, 'someone-else']);
  });
});
