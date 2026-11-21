// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { fixtureFiles, fixtureReader } from '../test/serviceFixture';
import { applyEdit, loadEngine, parseRequest, plan, requestFromLink, requestParams, RequestError, resolvePlace } from './engine';

const o = { site: 'https://site/i/', service: 'https://svc' };

describe('route service engine', () => {
  it('loads the data and plans a route from names, with the brief, the permalink and its own link', async () => {
    const e = await loadEngine(fixtureReader());
    expect(e.dataId).toBe('abcdef012345');
    const p = await plan(e, parseRequest(new URLSearchParams('from=Startowo&to=Metowo&draft=1.2&date=2027-05-01&avoidLocks=1')), o);
    expect(p.route.locks).toBe(1);
    expect(p.brief.title).toBe('Startowo → Metowo');
    expect(p.permalink).toMatch(/^https:\/\/site\/i\/\?from=17\.00000,51\.00000&to=17\.30000,51\.00000&draft=1\.2&.*&avoidLocks=1&date=2027-05-01&data=abcdef012345&was=21(\.\d)?,1$/);
    expect(p.serviceLink).toBe('https://svc/api/route?from=Startowo&to=Metowo&draft=1.2&avoidLocks=1&date=2027-05-01');
    expect(p.markdown).toContain('# Route: Startowo → Metowo');
    expect(p.brief.vessel.defaults).toEqual(['airDraft', 'beam', 'length']); // draft was given
  });

  it('reads data without places, a version or a checksum', async () => {
    const files = fixtureFiles({ files: { graph: 'graph.bin', geom: 'geom.bin' }, sha256: undefined, built: '2027-01-01' });
    const e = await loadEngine(fixtureReader(files));
    expect(e.pois).toEqual([]);
    expect(e.dataId).toBe('2027-01-01');
    expect((await loadEngine(fixtureReader(fixtureFiles({ sha256: undefined })))).dataId).toBeNull();
  });

  it('finds places: coordinates, names in the data, then the online search', async () => {
    const geocode = vi.fn(async (q: string) => (q === 'Nowhere' ? [] : [{ label: 'Środkowo, Polska', position: [17.2, 51.0] as [number, number] }]));
    const e = await loadEngine(fixtureReader(), geocode);
    expect(await resolvePlace(e, '17.1,51', 'from')).toEqual({ position: [17.1, 51], label: '17.1,51' });
    expect(await resolvePlace(e, 'startowo', 'from')).toEqual({ position: [17, 51], label: 'Startowo' });
    expect(geocode).not.toHaveBeenCalled();
    // "Środek" is inside a marina's name but does not start it: the online search answers first
    expect(await resolvePlace(e, 'Środek', 'via')).toEqual({ position: [17.2, 51], label: 'Środkowo, Polska' });
    // nothing online: the data's partial match; nothing anywhere: a clear error
    expect(await resolvePlace(e, 'Nowhere', 'to').catch((x) => x.message)).toBe('No place found for to "Nowhere": give coordinates as lon,lat, or another name');
    geocode.mockRejectedValueOnce(new Error('offline'));
    expect((await resolvePlace(e, 'Środek', 'via')).label).toBe('Przystań Środek');
    const offline = await loadEngine(fixtureReader());
    expect((await resolvePlace(offline, 'Środek', 'via')).label).toBe('Przystań Środek');
  });

  it('checks the link parameters', () => {
    const bad = (q: string) => { try { parseRequest(new URLSearchParams(q)); return ''; } catch (e) { return (e as RequestError).message; } };
    expect(bad('from=a')).toBe('Give from and to (place names, or lon,lat)');
    expect(bad('from=a&to=b&draft=deep')).toBe('draft must be a number');
    expect(bad('from=a&to=b&draft=-1')).toBe('draft must be a number');
    expect(bad('from=a&to=b&date=soon')).toBe('date must be YYYY-MM-DD');
    const r = parseRequest(new URLSearchParams('from=a&to=b&via=c;%20d|e;&speed=&coastal=true&avoidSea=0'));
    expect(r).toEqual({ from: 'a', to: 'b', via: ['c', 'd', 'e'], vessel: { coastal: true, avoidSea: false } });
    expect(requestParams(r).toString()).toBe('from=a&to=b&via=c%3Bd%3Be&coastal=1');
  });

  it('edits a route: add, move and remove stops, change the ends and the boat', () => {
    const r = { from: 'A', to: 'B', via: ['X', 'Y'], vessel: { draft: 1 } };
    expect(applyEdit(r, { add_stop: { place: 'Z' } }).via).toEqual(['X', 'Y', 'Z']);
    expect(applyEdit(r, { add_stop: { place: 'Z', index: 0 } }).via).toEqual(['Z', 'X', 'Y']);
    expect(applyEdit(r, { remove_stop: { index: 1 } }).via).toEqual(['X']);
    expect(applyEdit(r, { move_stop: { from: 1, to: 0 } }).via).toEqual(['Y', 'X']);
    expect(applyEdit(r, { from: 'C', to: 'D', vessel: { airDraft: 3 } })).toEqual({ from: 'C', to: 'D', via: ['X', 'Y'], vessel: { draft: 1, airDraft: 3 } });
    expect(() => applyEdit(r, { remove_stop: { index: 2 } })).toThrow('No stop 2: the route has 2');
    expect(() => applyEdit(r, { move_stop: { from: 0, to: 5 } })).toThrow('Stops are numbered 0 to 1');
    expect(() => applyEdit(r, { add_stop: { place: 'Z', index: 3 } })).toThrow('A stop can go at 0 to 2');
    expect(r.via).toEqual(['X', 'Y']); // the original is left as it was
  });

  it('reads a request back from a service link or a website permalink', () => {
    expect(requestFromLink('https://svc/api/route?from=A&to=B&via=X').via).toEqual(['X']);
    expect(requestFromLink('https://site/i/?from=17,51&to=17.3,51&draft=1&data=x&was=1,2')).toEqual({ from: '17,51', to: '17.3,51', via: [], vessel: { draft: 1 } });
    expect(() => requestFromLink('from=A')).toThrow('link must be a full Interway link');
  });

  it('says why there is no route', async () => {
    const e = await loadEngine(fixtureReader());
    await expect(plan(e, parseRequest(new URLSearchParams('from=Startowo&to=Metowo&len=500&beam=0')), o)).resolves.toBeTruthy();
    const tiny = fixtureFiles();
    const far = await loadEngine(fixtureReader(tiny));
    await expect(plan(far, parseRequest(new URLSearchParams('from=Startowo&to=Metowo&draft=1&air=0.1')), o)).resolves.toBeTruthy();
    vi.spyOn(far.router, 'routeVia').mockImplementation(() => { throw new Error('No navigable route found'); });
    await expect(plan(far, parseRequest(new URLSearchParams('from=Startowo&to=Metowo')), o)).rejects.toThrow(RequestError);
  });
});

describe('limits and caches', () => {
  it('keeps the most recently used entries', async () => {
    const { Lru } = await import('./engine');
    const c = new Lru<number>(2);
    c.set('a', 1);
    c.set('b', 2);
    expect(c.get('a')).toBe(1); // a is now the newest
    c.set('c', 3); // b goes
    expect([c.get('a'), c.get('b'), c.get('c')]).toEqual([1, undefined, 3]);
    c.delete('a');
    expect(c.get('a')).toBeUndefined();
  });

  it('asks the online search once per name, and not again after a failure', async () => {
    const { cachedGeocoder } = await import('./engine');
    const inner = vi.fn(async (q: string) => [{ label: q, position: [1, 2] as [number, number] }]);
    const g = cachedGeocoder(inner);
    await g('Mikołajki');
    await g(' mikolajki ');
    expect(inner).toHaveBeenCalledTimes(1);
    const failing = cachedGeocoder(vi.fn(async () => { throw new Error('down'); }));
    expect(await failing('x')).toEqual([]);
  });

  it('refuses requests too big to be cheap', async () => {
    const { MAX_PLACE_CHARS, MAX_STOPS } = await import('./engine');
    const e = await loadEngine(fixtureReader());
    await expect(resolvePlace(e, 'x'.repeat(MAX_PLACE_CHARS + 1), 'from')).rejects.toThrow('from is too long');
    expect(() => parseRequest(new URLSearchParams(`from=a&to=b&via=${Array(MAX_STOPS + 1).fill('c').join(';')}`))).toThrow(`At most ${MAX_STOPS} stops`);
    const full = { from: 'a', to: 'b', via: Array(MAX_STOPS).fill('c'), vessel: {} };
    expect(() => applyEdit(full, { add_stop: { place: 'd' } })).toThrow(`At most ${MAX_STOPS} stops`);
  });
});
