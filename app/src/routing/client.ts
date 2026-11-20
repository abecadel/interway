import type { LngLat } from '../graph/geo';
import type { Route, VesselProfile } from './router';
import type { LoadResult, WorkerRequest, WorkerResponse } from './service';

type Pending = { resolve: (v: unknown) => void; reject: (e: Error) => void };

/** The part of the Worker API the client uses (lets tests pass a fake). */
export interface WorkerLike {
  onmessage: ((ev: MessageEvent<WorkerResponse>) => void) | null;
  postMessage(msg: WorkerRequest): void;
}

type Request = WorkerRequest extends infer R ? (R extends WorkerRequest ? Omit<R, 'id'> : never) : never;

const createWorker = (): WorkerLike => new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });

/** Promise wrapper around the routing Web Worker. */
export class RoutingClient {
  private worker: WorkerLike;
  private nextId = 1;
  private pending = new Map<number, Pending>();

  constructor(worker: WorkerLike = createWorker()) {
    this.worker = worker;
    this.worker.onmessage = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.ok) p.resolve(data.result);
      else p.reject(new Error(data.error));
    };
  }

  private call<T>(msg: Request): Promise<T> {
    const id = this.nextId++;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.worker.postMessage({ ...msg, id } as WorkerRequest);
    });
  }

  load(baseUrl: string) {
    return this.call<LoadResult>({ type: 'load', baseUrl });
  }

  route(from: LngLat, to: LngLat, profile: VesselProfile, via: LngLat[] = []) {
    return this.call<Route>({ type: 'route', from, to, profile, via });
  }

  /** Other reasonable routes than the best one, best first (none when there is no real choice). */
  alternatives(from: LngLat, to: LngLat, profile: VesselProfile) {
    return this.call<Route[]>({ type: 'alternatives', from, to, profile });
  }

  network() {
    return this.call<GeoJSON.FeatureCollection>({ type: 'network' });
  }
}

export type RoutingApi = Pick<RoutingClient, 'load' | 'route' | 'alternatives' | 'network'>;
