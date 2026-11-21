// @vitest-environment node
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { fixtureFiles } from '../test/serviceFixture';
import { loadEngine } from './engine';
import { dataReader, main, serve, settings } from './server';

const port = (s: { address(): unknown }) => (s.address() as { port: number }).port;

describe('route service server', () => {
  it('reads data from a directory or a URL', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iw-'));
    for (const [name, b] of Object.entries(fixtureFiles())) await writeFile(join(dir, name), new Uint8Array(b));
    expect((await loadEngine(dataReader({ DATA_DIR: dir }))).dataId).toBe('abcdef012345');
    const files = fixtureFiles();
    const fetchFn = vi.fn(async (url: string) => {
      const name = url.split('/').pop()!;
      return name in files ? new Response(files[name]) : new Response('no', { status: 404 });
    });
    expect((await loadEngine(dataReader({ DATA_URL: 'https://x/data' }, fetchFn as never))).dataId).toBe('abcdef012345');
    expect(fetchFn).toHaveBeenCalledWith('https://x/data/manifest.json');
    await expect(dataReader({ DATA_URL: 'https://x/data/' }, fetchFn as never)('nope.bin')).rejects.toThrow('https://x/data/nope.bin: HTTP 404');
    await expect(dataReader({})('manifest.json')).rejects.toThrow(); // ./data is not here
  });

  it('takes its port and addresses from the environment', () => {
    expect(settings({})).toEqual({ port: 8080, options: { site: 'https://abecadel.github.io/interway/', service: '' } });
    expect(settings({ PORT: '9', SITE_URL: 'https://s/', SERVICE_URL: 'https://api.x/' })).toEqual({ port: 9, options: { site: 'https://s/', service: 'https://api.x' } });
  });

  it('serves HTTP and MCP, and reports internal errors', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'iw-'));
    for (const [name, b] of Object.entries(fixtureFiles())) await writeFile(join(dir, name), new Uint8Array(b));
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});
    const server = await main({ DATA_DIR: dir, PORT: '0', GEOCODE: '0' });
    const base = `http://localhost:${port(server)}`;
    expect(await (await fetch(`${base}/api/route?from=Startowo&to=Metowo`)).text()).toContain('# Route: Startowo → Metowo');
    // links point to the public address: the one the Worker forwards, else the Host header
    const own = await (await fetch(`${base}/api/route?from=Startowo&to=Metowo`)).text();
    expect(own).toContain(`Service link (change it to edit the route): ${base.replace('localhost', 'localhost')}/api/route?`);
    const fwd = await (await fetch(`${base}/api/route?from=Startowo&to=Metowo`, { headers: { 'x-forwarded-origin': 'https://iw.example.dev' } })).text();
    expect(fwd).toContain('Service link (change it to edit the route): https://iw.example.dev/api/route?');
    const r = await fetch(`${base}/mcp`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
    expect(await r.json()).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    const engine = await loadEngine(async (n) => fixtureFiles()[n]);
    vi.spyOn(engine.index, 'search').mockImplementation(() => { throw new Error('boom'); });
    const broken = serve(engine, { site: 's', service: 'x' });
    await new Promise<void>((done) => broken.listen(0, done));
    const bad = await fetch(`http://localhost:${port(broken)}/api/place?q=a`);
    expect(bad.status).toBe(500);
    expect(await bad.text()).toBe('Internal error: boom');
    await new Promise((done) => broken.close(done));
    await new Promise((done) => server.close(done));
    expect(log).toHaveBeenCalledWith(expect.stringContaining('Interway route service on port'));
    // with the online search and the defaults
    const online = await main({ DATA_DIR: dir, PORT: '0' });
    await new Promise((done) => online.close(done));
    log.mockRestore();
  });
});
