// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { fixtureReader } from '../test/serviceFixture';
import { type Engine, loadEngine } from './engine';
import { handle, help, TOOLS } from './handler';

const o = { site: 'https://site/i/', service: 'https://svc' };
let e: Engine;
beforeAll(async () => { e = await loadEngine(fixtureReader()); });

const get = (path: string) => handle(e, new Request(`https://svc${path}`), o);
const rpc = async (body: unknown) => {
  const r = await handle(e, new Request('https://svc/mcp', { method: 'POST', body: typeof body === 'string' ? body : JSON.stringify(body) }), o);
  return { status: r.status, body: r.status === 202 ? null : await r.json() };
};
const tool = async (name: string, args: Record<string, unknown>) =>
  (await rpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } })).body.result;

describe('route service over HTTP', () => {
  it('explains itself at / and /llms.txt', async () => {
    const r = await get('/');
    expect(r.headers.get('content-type')).toContain('text/markdown');
    expect(r.headers.get('access-control-allow-origin')).toBe('*');
    expect(await r.text()).toBe(help(o));
    expect(await (await get('/llms.txt')).text()).toContain('GET https://svc/api/route?from=');
  });

  it('answers a route link with the brief, the permalink and the service link', async () => {
    const md = await (await get('/api/route?from=Startowo&to=Metowo&draft=1.2')).text();
    expect(md).toContain('# Route: Startowo → Metowo');
    expect(md).toMatch(/Permalink \(open on the website\): https:\/\/site\/i\/\?from=17\.00000,51\.00000.*&was=/);
    expect(md).toContain('Service link (change it to edit the route): https://svc/api/route?from=Startowo&to=Metowo&draft=1.2');
    const j = await (await get('/api/route?from=Startowo&to=Metowo&format=json')).json();
    expect(j.totals.locks).toBe(1);
    expect(j.permalink).toContain('data=abcdef012345');
    expect(j.serviceLink).toBe('https://svc/api/route?from=Startowo&to=Metowo');
  });

  it('says what is wrong with a request', async () => {
    const r = await get('/api/route?from=Startowo');
    expect(r.status).toBe(400);
    expect(await r.text()).toContain('Give from and to');
    expect((await get('/elsewhere')).status).toBe(404);
    expect((await get('/api/waterway?id=nope')).status).toBe(400);
    expect((await get('/api/waterway')).status).toBe(400);
    const crash = vi.spyOn(e.index, 'search').mockImplementationOnce(() => { throw new Error('boom'); });
    await expect(get('/api/place?q=x')).rejects.toThrow('boom'); // not a request error: the server's 500
    crash.mockRestore();
  });

  it('finds places and gives waterway sheets', async () => {
    expect(await (await get('/api/place?q=metowo')).json()).toEqual([{ name: 'Metowo · town', lon: 17.3, lat: 51 }]);
    expect(await (await get('/api/place')).json()).toEqual([]);
    const { WATERWAYS } = await import('../routing/waterways');
    expect((await (await get(`/api/waterway?id=${WATERWAYS[0].id}`)).json()).name).toBe(WATERWAYS[0].name);
  });

  it('links back to the address the request came in on when it has none of its own', async () => {
    const md = await (await handle(e, new Request('https://iw.example.dev/api/route?from=Startowo&to=Metowo'), { ...o, service: '' })).text();
    expect(md).toContain('Service link (change it to edit the route): https://iw.example.dev/api/route?from=Startowo&to=Metowo');
  });

  it('refuses oversized requests, caches answers and marks what may be cached', async () => {
    const { MAX_QUERY_CHARS, MAX_BODY_BYTES, MAX_BATCH, CACHE_SECONDS } = await import('./handler');
    expect((await get(`/api/route?from=${'a'.repeat(MAX_QUERY_CHARS)}&to=b`)).status).toBe(414);
    const big = await rpc({ jsonrpc: '2.0', id: 1, method: 'ping', params: { pad: 'x'.repeat(MAX_BODY_BYTES) } });
    expect([big.status, big.body.error.code]).toEqual([413, -32600]);
    const many = await rpc(Array.from({ length: MAX_BATCH + 1 }, (_, i) => ({ jsonrpc: '2.0', id: i, method: 'ping' })));
    expect(many.body.error.message).toBe(`At most ${MAX_BATCH} requests in a batch`);
    const ok = await get('/api/route?from=Startowo&to=Metowo');
    expect(ok.headers.get('cache-control')).toBe(`public, max-age=${CACHE_SECONDS}`);
    expect((await get('/api/route?from=Startowo')).headers.get('cache-control')).toBe('no-store');
    const m = await handle(e, new Request('https://svc/mcp', { method: 'POST', body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) }), o);
    expect(m.headers.get('cache-control')).toBe('no-store');
    // the same route again comes from memory; a failed one is tried again
    const spy = vi.spyOn(e.router, 'routeVia');
    await get('/api/route?from=Startowo&to=Metowo&speed=7');
    await get('/api/route?from=Startowo&to=Metowo&speed=7');
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockImplementationOnce(() => { throw new Error('No navigable route found'); });
    expect((await get('/api/route?from=Startowo&to=Metowo&speed=6')).status).toBe(400);
    expect((await get('/api/route?from=Startowo&to=Metowo&speed=6')).status).toBe(200);
    spy.mockRestore();
  });

  it('answers CORS preflight', async () => {
    const r = await handle(e, new Request('https://svc/api/route', { method: 'OPTIONS' }), o);
    expect(r.status).toBe(204);
    expect(r.headers.get('access-control-allow-methods')).toContain('POST');
  });
});

describe('route service over MCP', () => {
  it('initialises, lists its tools and answers pings', async () => {
    const init = (await rpc({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })).body;
    expect(init.result).toMatchObject({ protocolVersion: '2025-03-26', serverInfo: { name: 'interway' }, capabilities: { tools: {} } });
    expect((await rpc({ jsonrpc: '2.0', id: 2, method: 'initialize' })).body.result.protocolVersion).toBe('2025-06-18');
    expect((await rpc({ jsonrpc: '2.0', method: 'notifications/initialized' })).status).toBe(202);
    expect((await rpc({ jsonrpc: '2.0', id: 3, method: 'tools/list' })).body.result.tools.map((t: { name: string }) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect((await rpc({ jsonrpc: '2.0', id: 4, method: 'ping' })).body.result).toEqual({});
    const batch = (await rpc([{ jsonrpc: '2.0', id: 5, method: 'ping' }, { jsonrpc: '2.0', method: 'notifications/x' }])).body;
    expect(batch).toEqual([{ jsonrpc: '2.0', id: 5, result: {} }]);
  });

  it('refuses what it cannot do', async () => {
    expect((await rpc({ jsonrpc: '2.0', id: 1, method: 'resources/list' })).body.error).toEqual({ code: -32601, message: 'Method not found: resources/list' });
    expect((await rpc('{')).body.error.code).toBe(-32700);
    expect((await handle(e, new Request('https://svc/mcp'), o)).status).toBe(405);
    expect(await tool('fly', {})).toEqual({ content: [{ type: 'text', text: 'Unknown tool fly' }], isError: true });
    const crash = vi.spyOn(e.index, 'search').mockImplementationOnce(() => { throw new Error('boom'); });
    expect((await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call', params: { name: 'find_place', arguments: { query: 'x' } } })).body.error)
      .toEqual({ code: -32603, message: 'boom' });
    crash.mockRestore();
    expect((await rpc({ jsonrpc: '2.0', id: 9, method: 'tools/call' })).body.result.isError).toBe(true); // no tool name
  });

  it('plans a route, then edits it with its service link: a stop, the boat and the date', async () => {
    const planned = (await tool('plan_route', { from: 'Startowo', to: 'Metowo', via: ['Przystań Środek'],
      vessel: { draft: 1.2, airDraft: 2.5, beam: 3, length: 9, speedKmh: 8, lockPenaltyMin: 15, departure: '2027-05-01', coastal: true, avoidSea: false, colour: 'red' } })).content[0].text;
    expect(planned).toContain('# Route: Startowo → Metowo');
    const link = planned.match(/Service link \(change it to edit the route\): (\S+)/)![1];
    expect(link).toBe('https://svc/api/route?from=Startowo&to=Metowo&via=Przysta%C5%84+%C5%9Arodek&draft=1.2&air=2.5&beam=3&len=9&speed=8&lockmin=15&coastal=1&date=2027-05-01');
    const edited = (await tool('edit_route', { link, remove_stop: { index: 0 }, add_stop: { place: '17.25,51' }, vessel: { draft: 1.5 } })).content[0].text;
    expect(edited).toContain('via=17.25%2C51&draft=1.5&air=2.5');
    expect((await tool('edit_route', { link, remove_stop: { index: 4 } })).isError).toBe(true);
    expect((await tool('plan_route', { from: 'Startowo', to: 'Metowo', vessel: 'big' })).content[0].text).toContain('# Route');
    expect((await tool('plan_route', {})).isError).toBe(true);
    expect((await tool('edit_route', {})).content[0].text).toContain('link must be a full Interway link');
  });

  it('finds places and gives waterway sheets', async () => {
    expect((await tool('find_place', { query: 'Metowo' })).content[0].text).toBe('- Metowo · town: 17.3,51');
    expect((await tool('find_place', { query: 'Nowhere' })).content[0].text).toBe('Nothing found for "Nowhere"');
    expect((await tool('find_place', {})).content[0].text).toBe('Nothing found for ""');
    const { WATERWAYS } = await import('../routing/waterways');
    expect(JSON.parse((await tool('get_waterway', { id: WATERWAYS[0].id })).content[0].text).id).toBe(WATERWAYS[0].id);
    expect((await tool('get_waterway', {})).isError).toBe(true);
  });
});
