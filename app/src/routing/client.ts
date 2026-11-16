import type { LngLat } from '../graph/geo';
import type { Route, VesselProfile } from './router';
import type { Manifest, WorkerRequest } from './worker';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** Promise wrapper around the routing Web Worker. */
export class RoutingClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker.onmessage = (ev) => {
      const { id, ok, result, error } = ev.data;
      const p = this.pending.get(id);
      if (!p) return;
      this.pending.delete(id);
      if (ok) p.resolve(result);
      else p.reject(new Error(error));
    };
  }

  // Distributes over the union so each request keeps its own fields.
  private call<T>(msg: WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, 'id'> : never) : never): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...msg, id });
    });
  }

  load(baseUrl: string) {
    return this.call<{ manifest: Manifest; nodes: number; edges: number }>({ type: 'load', baseUrl });
  }

  route(from: LngLat, to: LngLat, profile: VesselProfile) {
    return this.call<Route>({ type: 'route', from, to, profile });
  }

  network() {
    return this.call<GeoJSON.FeatureCollection>({ type: 'network' });
  }
}
