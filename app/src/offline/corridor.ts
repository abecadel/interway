// Saves the map along a route for use without a network: basemap and seamark tiles within a corridor of the
// route line, plus the style, fonts and sprites the basemap needs. Kept in their own cache, never trimmed.
import { haversine, type LngLat } from '../graph/geo';

/**
 * The service worker's saved-maps cache (`route` in strategy.ts). Not imported from there: a module shared by the
 * page and the service worker becomes a chunk the worker would have to `import`, which a classic service worker
 * cannot.
 */
export const ROUTE_CACHE = 'interway-route-v1';
export const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
export const SEAMARK_TILES = 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png';
export const CORRIDOR_M = 1000;
export const MIN_ZOOM = 8;
export const MAX_ZOOM = 14;
export const SEAMARK_MIN_ZOOM = 9;
export const MAX_TILES = 10_000;
/** Latin, Latin-1 and Latin Extended (Polish, Czech, Hungarian... letters) */
const GLYPH_RANGES = ['0-255', '256-511'];
const PARALLEL = 6;

const tileX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const tileY = (lat: number, z: number) => {
  const r = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z);
};

/** "z/x/y" of every tile within `bufferM` of the line, at zooms minZ..maxZ. */
export function corridorTiles(line: LngLat[], minZ = MIN_ZOOM, maxZ = MAX_ZOOM, bufferM = CORRIDOR_M): string[] {
  const out = new Set<string>();
  // sample the line every few hundred metres (well under a z14 tile) and cover a box of the buffer around each sample
  const pts: LngLat[] = [];
  for (let i = 0; i < line.length; i++) {
    pts.push(line[i]);
    if (i + 1 < line.length) {
      const [a, b] = [line[i], line[i + 1]];
      const n = Math.floor(haversine(a[1], a[0], b[1], b[0]) / 500);
      for (let k = 1; k <= n; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / (n + 1), a[1] + ((b[1] - a[1]) * k) / (n + 1)]);
    }
  }
  for (const [lon, lat] of pts) {
    const dLat = bufferM / 111_195;
    const dLon = dLat / Math.max(Math.cos((lat * Math.PI) / 180), 0.1);
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = tileX(lon - dLon, z); x <= tileX(lon + dLon, z); x++) {
        for (let y = tileY(lat + dLat, z); y <= tileY(lat - dLat, z); y++) out.add(`${z}/${x}/${y}`);
      }
    }
  }
  return [...out];
}

const fill = (template: string, zxy: string) => {
  const [z, x, y] = zxy.split('/');
  return template.replace('{z}', z).replace('{x}', x).replace('{y}', y);
};

interface Style {
  sources: Record<string, { url?: string; tiles?: string[]; maxzoom?: number }>;
  glyphs?: string;
  sprite?: string;
  layers: { layout?: { 'text-font'?: string[] } }[];
}

/** The deepest zoom whose corridor (basemap and seamarks) stays within MAX_TILES; null when even z11 does not. */
export function corridorZoom(line: LngLat[]): number | null {
  // one pass over all zooms, then add them up: tiles down to z = basemap z8..z + seamarks z9..z
  const perZoom = new Map<number, number>();
  for (const t of corridorTiles(line, MIN_ZOOM, MAX_ZOOM)) {
    const z = Number(t.split('/')[0]);
    perZoom.set(z, (perZoom.get(z) ?? 0) + 1);
  }
  let best: number | null = null;
  let total = 0;
  for (let z = MIN_ZOOM; z <= MAX_ZOOM; z++) {
    total += perZoom.get(z)! * (z >= SEAMARK_MIN_ZOOM ? 2 : 1); // a line has tiles at every zoom
    if (total > MAX_TILES) break;
    if (z >= MIN_ZOOM + 3) best = z;
  }
  return best;
}

/** Every URL the map needs offline along the line down to zoom maxZ (style first). */
export async function corridorUrls(line: LngLat[], maxZ = MAX_ZOOM, fetchFn: typeof fetch = fetch): Promise<string[]> {
  const style = (await (await fetchFn(STYLE_URL)).json()) as Style;
  const urls = [STYLE_URL];
  for (const src of Object.values(style.sources)) {
    let tiles = src.tiles;
    let maxzoom = src.maxzoom ?? MAX_ZOOM;
    if (src.url) {
      urls.push(src.url);
      const tj = (await (await fetchFn(src.url)).json()) as { tiles: string[]; maxzoom?: number };
      tiles = tj.tiles;
      maxzoom = tj.maxzoom ?? maxzoom;
    }
    if (!tiles?.length || maxzoom < MIN_ZOOM) continue; // the low-zoom relief layer is not needed on the water
    const tpl = tiles[0];
    urls.push(...corridorTiles(line, MIN_ZOOM, Math.min(maxZ, maxzoom)).map((t) => fill(tpl, t)));
  }
  urls.push(...corridorTiles(line, SEAMARK_MIN_ZOOM, maxZ).map((t) => fill(SEAMARK_TILES, t)));
  if (style.sprite) for (const s of ['', '@2x']) urls.push(`${style.sprite}${s}.json`, `${style.sprite}${s}.png`);
  if (style.glyphs) {
    const fonts = new Set(style.layers.flatMap((l) => l.layout?.['text-font'] ?? []));
    for (const f of fonts) for (const r of GLYPH_RANGES) urls.push(style.glyphs.replace('{fontstack}', encodeURIComponent(f)).replace('{range}', r));
  }
  return urls;
}

export interface SaveResult {
  saved: number;
  failed: number;
}

/** Fetches the URLs into the saved-maps cache, a few at a time; already saved ones are skipped. */
export async function saveUrls(
  urls: string[], onProgress: (done: number, total: number) => void, signal?: AbortSignal,
  fetchFn: typeof fetch = fetch, store: CacheStorage = caches,
): Promise<SaveResult> {
  const cache = await store.open(ROUTE_CACHE);
  let next = 0, done = 0, failed = 0;
  const worker = async () => {
    while (next < urls.length && !signal?.aborted) {
      const url = urls[next++];
      try {
        if (!(await cache.match(url))) {
          const res = await fetchFn(url, { signal });
          if (res.ok) await cache.put(url, res);
          else failed++;
        }
      } catch {
        failed++;
      }
      onProgress(++done, urls.length);
    }
  };
  await Promise.all(Array.from({ length: PARALLEL }, worker));
  return { saved: done - failed, failed };
}

export async function clearSaved(store: CacheStorage = caches): Promise<boolean> {
  return store.delete(ROUTE_CACHE);
}
