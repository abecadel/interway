// Caching rules for the service worker, kept separate from worker globals so they can be unit-tested.

export const CACHES = {
  app: 'interway-app-v1',
  data: 'interway-data-v1',
  tiles: 'interway-tiles-v1',
} as const;

/** Tiles viewed most recently are kept; the oldest are dropped beyond this many entries. */
export const MAX_TILES = 6000;

export type Strategy = 'app' | 'data' | 'tiles' | 'bypass';

const TILE_HOSTS = ['tiles.openfreemap.org', 'tiles.openseamap.org'];

export function strategyFor(url: URL, origin: string): Strategy {
  if (TILE_HOSTS.includes(url.hostname)) return 'tiles';
  if (url.origin !== origin) return 'bypass'; // search, other APIs: always live
  if (url.pathname.includes('/data/')) return 'data';
  return 'app';
}

type Fetch = (req: Request) => Promise<Response>;

export interface CacheLike {
  match(req: Request): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
  keys(): Promise<readonly Request[]>;
  delete(req: Request): Promise<boolean>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

/** Network first, cache as fallback: new app versions arrive at once, the last one works offline. */
async function networkFirst(req: Request, cache: CacheLike, fetchFn: Fetch): Promise<Response> {
  try {
    const res = await fetchFn(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (e) {
    const hit = await cache.match(req);
    if (hit) return hit;
    throw e;
  }
}

/** Cache first, refreshed in the background: big waterway files load instantly and update next time. */
async function staleWhileRevalidate(req: Request, cache: CacheLike, fetchFn: Fetch, wait: (p: Promise<unknown>) => void) {
  const hit = await cache.match(req);
  const refresh = fetchFn(req).then(async (res) => {
    if (res.ok) await cache.put(req, res.clone());
    return res;
  });
  if (hit) {
    wait(refresh.catch(() => undefined));
    return hit;
  }
  return refresh;
}

/** Cache first for map tiles, which never change in a way that matters on board. */
async function cacheFirst(req: Request, cache: CacheLike, fetchFn: Fetch, wait: (p: Promise<unknown>) => void) {
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetchFn(req);
  if (res.ok) {
    await cache.put(req, res.clone());
    wait(trim(cache, MAX_TILES));
  }
  return res;
}

export async function trim(cache: CacheLike, max: number): Promise<number> {
  const keys = await cache.keys();
  const extra = keys.slice(0, Math.max(0, keys.length - max));
  await Promise.all(extra.map((k) => cache.delete(k)));
  return extra.length;
}

/** Returns null when the service worker should not answer (non-GET or bypassed requests). */
export async function handleFetch(
  req: Request, origin: string, caches: CacheStorageLike, fetchFn: Fetch, wait: (p: Promise<unknown>) => void,
): Promise<Response> {
  const strategy = strategyFor(new URL(req.url), origin);
  if (strategy === 'app') return networkFirst(req, await caches.open(CACHES.app), fetchFn);
  if (strategy === 'data') return staleWhileRevalidate(req, await caches.open(CACHES.data), fetchFn, wait);
  return cacheFirst(req, await caches.open(CACHES.tiles), fetchFn, wait);
}

export function shouldHandle(req: Request, origin: string): boolean {
  return req.method === 'GET' && strategyFor(new URL(req.url), origin) !== 'bypass';
}

/** Removes caches from older versions of the app. */
export async function cleanup(caches: CacheStorageLike): Promise<string[]> {
  const current = new Set<string>(Object.values(CACHES));
  const old = (await caches.keys()).filter((k) => k.startsWith('interway-') && !current.has(k));
  await Promise.all(old.map((k) => caches.delete(k)));
  return old;
}
