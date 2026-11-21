// Caching rules for the service worker, kept separate from worker globals so they can be unit-tested.

export const CACHES = {
  app: 'interway-app-v1',
  data: 'interway-data-v1',
  tiles: 'interway-tiles-v1',
  /** map saved along a route for offline use: never trimmed */
  route: 'interway-route-v1',
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
  match(req: Request, options?: CacheQueryOptions): Promise<Response | undefined>;
  put(req: Request, res: Response): Promise<void>;
  keys(): Promise<readonly Request[]>;
  delete(req: Request): Promise<boolean>;
}

export interface CacheStorageLike {
  open(name: string): Promise<CacheLike>;
  keys(): Promise<string[]>;
  delete(name: string): Promise<boolean>;
}

/**
 * Network first, cache as fallback: new app versions arrive at once, the last one works offline.
 * An offline page load with any query (a shared route link) gets the cached app page.
 */
async function networkFirst(req: Request, cache: CacheLike, fetchFn: Fetch, shell?: string): Promise<Response> {
  try {
    const res = await fetchFn(req);
    if (res.ok) await cache.put(req, res.clone());
    return res;
  } catch (e) {
    const page = shell && req.headers.get('accept')?.includes('text/html');
    // ignoreVary: module scripts send an Origin header that the files cached at install did not
    const hit = (await cache.match(req, { ignoreVary: true })) ?? (page ? await cache.match(new Request(shell)) : undefined);
    if (hit) return hit;
    throw e;
  }
}

/** Cache first, refreshed in the background: big waterway files load instantly and update next time. */
async function staleWhileRevalidate(req: Request, cache: CacheLike, fetchFn: Fetch, wait: (p: Promise<unknown>) => void) {
  const hit = await cache.match(req, { ignoreVary: true });
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
  req: Request, origin: string, caches: CacheStorageLike, fetchFn: Fetch, wait: (p: Promise<unknown>) => void, shell?: string,
): Promise<Response> {
  const strategy = strategyFor(new URL(req.url), origin);
  if (strategy === 'app') return networkFirst(req, await caches.open(CACHES.app), fetchFn, shell);
  if (strategy === 'data') return staleWhileRevalidate(req, await caches.open(CACHES.data), fetchFn, wait);
  const saved = await (await caches.open(CACHES.route)).match(req);
  return saved ?? cacheFirst(req, await caches.open(CACHES.tiles), fetchFn, wait);
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

/**
 * Caches the app page, its scripts and workers, styles and their fonts, and the waterway data when the service
 * worker installs. They loaded before it took control, so without this the first visit would not
 * work offline. Each file is best effort; returns how many were cached.
 */
export async function precache(scope: string, caches: CacheStorageLike, fetchFn: Fetch): Promise<number> {
  const app = await caches.open(CACHES.app);
  const data = await caches.open(CACHES.data);
  const origin = new URL(scope).origin;
  let count = 0;
  const get = async (url: string, cache: CacheLike): Promise<Response | undefined> => {
    try {
      const res = await fetchFn(new Request(url));
      if (!res.ok) return undefined;
      await cache.put(new Request(url), res.clone());
      count++;
      return res;
    } catch {
      return undefined;
    }
  };
  const links = (text: string, pattern: RegExp, base: string) =>
    [...text.matchAll(pattern)].map((m) => new URL(m[1], base)).filter((u) => u.origin === origin).map((u) => u.href);
  const page = await get(scope, app);
  const queue = page ? links(await page.text(), /(?:src|href)="([^"]+)"/g, scope) : [];
  const seen = new Set(queue);
  // styles name their fonts; scripts name the web workers they start
  const nested: Record<string, RegExp> = { '.css': /url\(["']?([^"')]+)["']?\)/g, '.js': /["'`]([^"'`\s]*\/assets\/[\w.-]+\.m?js)["'`]/g };
  for (let url = queue.shift(); url; url = queue.shift()) {
    const res = await get(url, app);
    const pattern = nested[new URL(url).pathname.replace(/^.*(\.[^.]+)$/, '$1').replace('.mjs', '.js')];
    if (!res || !pattern) continue;
    for (const next of links(await res.text(), pattern, url)) {
      if (seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  const manifest = await get(scope + 'data/manifest.json', data);
  if (manifest) {
    const { files } = (await manifest.json().catch(() => ({ files: {} }))) as { files: Record<string, string> };
    await Promise.all(Object.values(files).map((f) => get(scope + 'data/' + f, data)));
  }
  return count;
}
