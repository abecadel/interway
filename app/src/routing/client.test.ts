import { describe, expect, it, vi } from 'vitest';
import { RoutingClient, type WorkerLike } from './client';
import { defaultProfile } from './router';
import type { WorkerRequest, WorkerResponse } from './service';

class FakeWorker implements WorkerLike {
  onmessage: ((ev: MessageEvent<WorkerResponse>) => void) | null = null;
  sent: WorkerRequest[] = [];
  postMessage(msg: WorkerRequest) {
    this.sent.push(msg);
  }
  reply(data: WorkerResponse) {
    this.onmessage!({ data } as MessageEvent<WorkerResponse>);
  }
}

describe('RoutingClient', () => {
  it('matches replies to requests by id', async () => {
    const w = new FakeWorker();
    const c = new RoutingClient(w);
    const load = c.load('/data/');
    const route = c.route([1, 2], [3, 4], defaultProfile);
    const net = c.network();
    expect(w.sent.map((m) => [m.id, m.type])).toEqual([[1, 'load'], [2, 'route'], [3, 'network']]);
    w.reply({ id: 3, ok: true, result: 'net' });
    w.reply({ id: 2, ok: false, error: 'no route' });
    w.reply({ id: 1, ok: true, result: 'loaded' });
    w.reply({ id: 99, ok: true, result: 'ignored' });
    await expect(load).resolves.toBe('loaded');
    await expect(route).rejects.toThrow('no route');
    await expect(net).resolves.toBe('net');
  });

  it('creates a module worker by default', () => {
    const ctor = vi.fn(function (this: { url: URL; opts: unknown }, url: URL, opts: unknown) {
      this.url = url;
      this.opts = opts;
    });
    vi.stubGlobal('Worker', ctor);
    new RoutingClient();
    expect(ctor).toHaveBeenCalledWith(expect.any(URL), { type: 'module' });
    expect(String((ctor.mock.calls[0] as unknown[])[0])).toMatch(/routing\/worker\.ts/);
    vi.unstubAllGlobals();
  });
});
