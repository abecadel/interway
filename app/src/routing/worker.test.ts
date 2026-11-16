import { describe, expect, it, vi } from 'vitest';

describe('worker entry', () => {
  it('answers messages through the routing service', async () => {
    const posted: unknown[] = [];
    vi.stubGlobal('postMessage', (m: unknown) => posted.push(m));
    await import('./worker');
    const handler = (self as unknown as { onmessage: (ev: { data: unknown }) => Promise<void> }).onmessage;
    await handler({ data: { id: 7, type: 'network' } });
    expect(posted).toEqual([{ id: 7, ok: false, error: 'Waterway data not loaded yet' }]);
    vi.unstubAllGlobals();
  });
});
