import { describe, expect, it, vi } from 'vitest';
import { empty, kanal, restricted } from '../test/waterwayFixture';

vi.mock('../data/waterways.json', () => ({ default: [] }));
const { aliasIndex, currentsByName, legPoints, monthsText, rulesText, seasonWarnings, tideText, waterwaysOn, waterwayWarnings, WATERWAYS } = await import('./waterways');
const { defaultProfile } = await import('./router');

describe('waterway sheets', () => {
  const index = aliasIndex([kanal, empty, restricted]);

  it('match legs by OSM name, in route order, each once; shared names give every sheet', () => {
    expect(waterwaysOn(['Low', 'unknown', 'der kanal', 'Kanal '], index).map((w) => w.id)).toEqual(['r', 'kanal']);
    expect(waterwaysOn(['Kanal'], index).map((w) => w.id)).toEqual(['kanal', 'r']);
    expect(waterwaysOn(['Kanal'])).toEqual([]); // the bundled data: empty in this test
    expect(WATERWAYS).toEqual([]);
  });

  it('tell sheets sharing a name apart by where the leg lies', () => {
    const north = { ...kanal, id: 'n', bbox: [0, 10, 10, 20] as [number, number, number, number] };
    const south = { ...kanal, id: 's', bbox: [0, 0, 10, 10] as [number, number, number, number] };
    const idx = aliasIndex([north, south]);
    expect(waterwaysOn([{ name: 'Kanal', at: [5, 15] }], idx).map((w) => w.id)).toEqual(['n']);
    expect(waterwaysOn([{ name: 'Kanal', at: [5, 5] }, { name: 'Kanal', at: [50, 5] }], idx).map((w) => w.id)).toEqual(['s']);
    expect(waterwaysOn([{ name: 'Kanal' }], idx).map((w) => w.id)).toEqual(['n', 's']); // no point: both
  });

  it('find the point halfway along each leg', () => {
    const route = { coordinates: [[0, 0], [0.01, 0], [0.02, 0], [0.03, 0]], legs: [{ name: 'A', distance: 1113 }, { name: 'B', distance: 2226 }] };
    const pts = legPoints(route as never);
    expect(pts.map((p) => p.name)).toEqual(['A', 'B']);
    expect(pts[0].at).toEqual([0, 0]); // halfway along A (556 m) is still before the first vertex step
    expect(pts[1].at).toEqual([0.02, 0]);
    expect(legPoints({ coordinates: [[1, 1]], legs: [{ name: 'X', distance: 10 }] } as never)).toEqual([{ name: 'X', at: [1, 1], distance: 10 }]);
    // a short leg (a junction carrying another canal's name) does not bring in that canal's sheet
    const idx = aliasIndex([kanal]);
    expect(waterwaysOn([{ name: 'Kanal', distance: 300 }], idx)).toEqual([]);
    expect(waterwaysOn([{ name: 'Kanal', distance: 3000 }], idx)).toEqual([kanal]);
  });

  it('sum up the months as runs', () => {
    expect(monthsText(kanal)).toBe('usually closed Jul–Oct; low water Jun; high water Feb–Mar; ice Jan. summit pound short of water');
    expect(monthsText({ ...kanal, months: { closed: [12, 1, 2, 5], lowWater: [], highWater: [], ice: [], notes: null } })).toBe('usually closed Jan–Feb, May, Dec');
    expect(monthsText({ ...kanal, months: { closed: [], lowWater: [], highWater: [], ice: [], notes: 'chômage 1–10 March' } })).toBe('chômage 1–10 March');
    expect(monthsText({ ...kanal, months: { closed: [], lowWater: [], highWater: [], ice: [], notes: null } })).toBeNull();
    expect(monthsText(empty)).toBeNull();
  });

  it('warn about each waterway as it is in the month the boat reaches it', () => {
    // 100 km at 10 km/h: 10 h underway, so the second leg (km 50) is reached on day 1 (8 h a day)
    const route = { distance: 100_000, duration: 36_000, coordinates: [[0, 0], [0.45, 0], [0.9, 0]],
      legs: [{ name: 'Low', distance: 50_000 }, { name: 'Kanal', distance: 50_000 }] } as never;
    const idx = aliasIndex([kanal, restricted]);
    expect(seasonWarnings(route, defaultProfile, idx)).toEqual([]); // no date
    expect(seasonWarnings(route, { ...defaultProfile, departure: 'next summer' }, idx)).toEqual([]); // not a date
    expect(seasonWarnings(route, { ...defaultProfile, departure: '2027-07-31' }, idx))
      .toEqual(['Kanal (A – B), reached around 2027-07-31: usually closed in July (summit pound short of water).',
        'No way round was found: this route still uses 1 waterway (Kanal (A – B)) usually closed when you reach it. Go in another month, or confirm with the authority that they will be open.',
        'All the waterways of this route are usually open and free of ice in Feb, Mar, Apr, May, Jun, Nov, Dec: a trip then avoids these closures.']);
    const two = aliasIndex([kanal, { ...kanal, id: 'k2', name: 'Low canal', aliases: ['Low'] }]);
    expect(seasonWarnings(route, { ...defaultProfile, departure: '2027-07-31' }, two))
      .toContain('No way round was found: this route still uses 2 waterways (Low canal, Kanal (A – B)) usually closed when you reach them. Go in another month, or confirm with the authority that they will be open.');
    const always = aliasIndex([{ ...kanal, months: { ...kanal.months!, closed: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] } }]);
    expect(seasonWarnings(route, { ...defaultProfile, departure: '2027-07-31' }, always).at(-1))
      .toBe('Some waterway of this route is usually closed in every month: compare the alternatives.');
    expect(seasonWarnings(route, { ...defaultProfile, departure: '2027-01-15' }, idx))
      .toEqual(['Kanal (A – B), reached around 2027-01-15: ice likely in January (summit pound short of water).', 'All the waterways of this route are usually open and free of ice in Feb, Mar, Apr, May, Jun, Nov, Dec.']);
    expect(seasonWarnings(route, { ...defaultProfile, departure: '2027-04-15' }, idx)).toEqual(['All the waterways of this route are usually open and free of ice in Feb, Mar, Apr, May, Jun, Nov, Dec.']); // nothing in April but when to go
    // closed now, but usually open in the month of the trip
    expect(seasonWarnings(route, { ...defaultProfile, departure: '2027-04-15' }, aliasIndex([{ ...kanal, navigable: 'closed' }]))[0])
      .toBe('Kanal (A – B), reached around 2027-04-15: closed as of ' + kanal.checked + ', but usually open in April: check that the closure has ended.');
    expect(seasonWarnings(route, { ...defaultProfile, departure: '2027-02-15' }, idx))
      .toEqual(['Kanal (A – B), reached around 2027-02-15: high water likely in February (summit pound short of water).', 'All the waterways of this route are usually open and free of ice in Feb, Mar, Apr, May, Jun, Nov, Dec.']);
    expect(seasonWarnings({ ...(route as object), distance: 0 } as never, { ...defaultProfile, departure: '2027-07-01' }, idx)).toEqual([]);
    expect(seasonWarnings(route, { ...defaultProfile, departure: '2027-06-01' }, aliasIndex([{ ...kanal, months: { ...kanal.months!, notes: null } }])))
      .toEqual(['Kanal (A – B), reached around 2027-06-01: low water likely in June.', 'All the waterways of this route are usually open and free of ice in Feb, Mar, Apr, May, Jun, Nov, Dec.']);
    expect(seasonWarnings(route, { ...defaultProfile, departure: '2027-07-01' })).toEqual([]); // bundled data: empty here
  });

  it('describe tides only where a waterway is tidal', () => {
    expect(tideText(kanal)).toBe('tidal, spring range about 0.3 m: to the first lock');
    expect(tideText({ ...kanal, tides: { tidal: true, rangeM: null, notes: null } })).toBe('tidal');
    expect(tideText({ ...kanal, tides: { tidal: false, rangeM: null, notes: null } })).toBeNull();
    expect(tideText(empty)).toBeNull(); // no tide data in the sheet
  });

  it('give currents by name, the lower where sheets share a name', () => {
    expect(Object.fromEntries(currentsByName([kanal, empty, restricted]))).toEqual({ kanal: 0.4, 'der kanal': 1.2, low: 0.4 });
    expect(currentsByName().size).toBe(0);
  });

  it('sum up who may use a waterway', () => {
    expect(rulesText(kanal)).toBeNull();
    const ruled = { ...kanal, rules: { motorboats: 'restricted' as const, speedLimitKmh: 12, permit: 'vignette', notes: 'no jet skis' } };
    expect(rulesText(ruled)).toBe('motorboats restricted; up to 12 km/h; permit: vignette; no jet skis');
    const banned = { ...kanal, rules: { motorboats: 'banned' as const, speedLimitKmh: null, permit: null, notes: null } };
    expect(rulesText(banned)).toBe('motorboats banned');
    expect(waterwayWarnings([banned], 1, 3)).toEqual(['Kanal (A – B): motorboats are not allowed (as of 2026-11-21), see About the waterways.']);
  });

  it('warn about closures, restrictions, draft and air draft', () => {
    expect(waterwayWarnings([kanal, empty, restricted], 2, 4)).toEqual([
      'Kanal (A – B): draft 2 m exceeds the usual 1.5 m.',
      'Kanal (A – B): air draft 4 m vs lowest bridge 4 m.',
      'Bare canal: closed as of 2026-11-21, see About the waterways.',
      'Low canal: navigation restricted as of 2026-11-21, see About the waterways.',
    ]);
    expect(waterwayWarnings([kanal], 1, 3)).toEqual([]);
    expect(waterwayWarnings([kanal], 1, 3.7)).toEqual(
      ['Kanal (A – B): lowest bridge 4 m leaves 0.3 m above your air draft 3.7 m; arched bridges are lower towards the sides: see About the waterways.']);
  });
});
