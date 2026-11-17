// Message handling for the routing worker, kept free of worker globals so it can be unit-tested.
import { COORD_SCALE, decodeGeometry, decodeGraph } from '../graph/format';
import type { LngLat } from '../graph/geo';
import { Router, type VesselProfile } from './router';

export interface Manifest {
  version: number;
  region: string;
  osmTimestamp?: string;
  files: { graph: string; geom: string; pois?: string };
  names: string[];
  attribution: string;
}

export type PoiType = 'lock' | 'bridge' | 'marina' | 'port' | 'fuel' | 'slipway' | 'water' | 'sanitary';

export interface Poi {
  type: PoiType;
  name: string;
  lat: number;
  lon: number;
  /** bridges: clearance under the bridge, m */
  clearance?: number;
  /** locks: chamber size, m */
  maxlength?: number;
  maxwidth?: number;
}

export interface LoadResult {
  manifest: Manifest;
  nodes: number;
  edges: number;
  pois: Poi[];
}

export type WorkerRequest =
  | { id: number; type: 'load'; baseUrl: string }
  | { id: number; type: 'route'; from: LngLat; to: LngLat; profile: VesselProfile }
  | { id: number; type: 'network' };

export type WorkerResponse =
  | { id: number; ok: true; result: unknown }
  | { id: number; ok: false; error: string };

type Fetch = (url: string) => Promise<Response>;

export class RoutingService {
  router: Router | null = null;
  private fetch: Fetch;

  constructor(fetchFn: Fetch = (url) => fetch(url)) {
    this.fetch = fetchFn;
  }

  private async buffer(url: string) {
    const res = await this.fetch(url);
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    return res.arrayBuffer();
  }

  /** Points of interest are optional: a missing file just means none are shown. */
  private async pois(url: string): Promise<Poi[]> {
    const res = await this.fetch(url);
    return res.ok ? ((await res.json()) as Poi[]) : [];
  }

  private loaded(): Router {
    if (!this.router) throw new Error('Waterway data not loaded yet');
    return this.router;
  }

  async handle(msg: WorkerRequest): Promise<unknown> {
    switch (msg.type) {
      case 'load': {
        const base = msg.baseUrl.endsWith('/') ? msg.baseUrl : msg.baseUrl + '/';
        const res = await this.fetch(base + 'manifest.json');
        if (!res.ok) throw new Error('No waterway data found (manifest.json missing). Run the pipeline first.');
        const manifest = (await res.json()) as Manifest;
        const [g, s] = await Promise.all([this.buffer(base + manifest.files.graph), this.buffer(base + manifest.files.geom)]);
        this.router = new Router(decodeGraph(g), decodeGeometry(s), manifest.names);
        const pois = manifest.files.pois ? await this.pois(base + manifest.files.pois) : [];
        return { manifest, nodes: this.router.graph.nodeCount, edges: this.router.graph.edgeCount, pois } satisfies LoadResult;
      }
      case 'route':
        return this.loaded().route(msg.from, msg.to, msg.profile);
      case 'network':
        return networkGeoJson(this.loaded());
    }
  }

  /** Never throws: errors become `{ ok: false }` responses. */
  async respond(msg: WorkerRequest): Promise<WorkerResponse> {
    try {
      return { id: msg.id, ok: true, result: await this.handle(msg) };
    } catch (e) {
      return { id: msg.id, ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }
}

export function networkGeoJson({ geom, names }: Router): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (let g = 0; g < geom.geomCount; g++) {
    const coordinates: LngLat[] = [];
    for (let p = geom.geomOffsets[g]; p < geom.geomOffsets[g + 1]; p++) {
      coordinates.push([geom.lon[p] / COORD_SCALE, geom.lat[p] / COORD_SCALE]);
    }
    features.push({ type: 'Feature', properties: { name: names[geom.nameIndex[g]] }, geometry: { type: 'LineString', coordinates } });
  }
  return { type: 'FeatureCollection', features };
}
