/// <reference lib="webworker" />
// Routing runs here so the UI stays responsive and everything works offline once the data files are cached.
import { COORD_SCALE, decodeGeometry, decodeGraph } from '../graph/format';
import type { LngLat } from '../graph/geo';
import { Router, RouteError, type VesselProfile } from './router';

export interface Manifest {
  version: number;
  region: string;
  osmTimestamp?: string;
  files: { graph: string; geom: string; pois?: string };
  names: string[];
  attribution: string;
}

export type WorkerRequest =
  | { id: number; type: 'load'; baseUrl: string }
  | { id: number; type: 'route'; from: LngLat; to: LngLat; profile: VesselProfile }
  | { id: number; type: 'network' };

let router: Router | null = null;

async function fetchBuffer(url: string) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.arrayBuffer();
}

async function handle(msg: WorkerRequest): Promise<unknown> {
  switch (msg.type) {
    case 'load': {
      const base = msg.baseUrl.endsWith('/') ? msg.baseUrl : msg.baseUrl + '/';
      const res = await fetch(base + 'manifest.json');
      if (!res.ok) throw new Error('No waterway data found (manifest.json missing). Run the pipeline first.');
      const manifest = (await res.json()) as Manifest;
      const [g, s] = await Promise.all([fetchBuffer(base + manifest.files.graph), fetchBuffer(base + manifest.files.geom)]);
      router = new Router(decodeGraph(g), decodeGeometry(s), manifest.names);
      return { manifest, nodes: router.graph.nodeCount, edges: router.graph.edgeCount };
    }
    case 'route': {
      if (!router) throw new Error('Waterway data not loaded yet');
      return router.route(msg.from, msg.to, msg.profile);
    }
    case 'network': {
      if (!router) throw new Error('Waterway data not loaded yet');
      const { geom, names } = router;
      const features = [];
      for (let g = 0; g < geom.geomCount; g++) {
        const coordinates: LngLat[] = [];
        for (let p = geom.geomOffsets[g]; p < geom.geomOffsets[g + 1]; p++) {
          coordinates.push([geom.lon[p] / COORD_SCALE, geom.lat[p] / COORD_SCALE]);
        }
        features.push({ type: 'Feature', properties: { name: names[geom.nameIndex[g]] ?? '' }, geometry: { type: 'LineString', coordinates } });
      }
      return { type: 'FeatureCollection', features };
    }
  }
}

self.onmessage = async (ev: MessageEvent<WorkerRequest>) => {
  const { id } = ev.data;
  try {
    const result = await handle(ev.data);
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e), routeError: e instanceof RouteError });
  }
};
