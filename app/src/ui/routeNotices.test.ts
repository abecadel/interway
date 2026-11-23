import { describe, expect, it, vi } from 'vitest';
import type { Route } from '../routing/router';
import { defaultProfile } from '../routing/router';
import { empty, kanal, restricted } from '../test/waterwayFixture';
import { routeNotices } from './routeNotices';

vi.mock('../data/waterways.json', async () => {
  const { kanal } = await import('../test/waterwayFixture');
  // a river that is never closed, only low in June
  const river = { ...kanal, id: 'river', name: 'Rzeka', aliases: ['Rzeka'], months: { closed: [], lowWater: [6], highWater: [], ice: [], notes: null } };
  return { default: [kanal, river] };
});

const route = {
  coordinates: [[0, 0], [1, 0]], distance: 1300, duration: 1680, locks: 1, unverified: 0, sea: 0, seaNoDepth: 0, offshore: 0, noMotor: 0, limits: [], downstream: 0, upstream: 0,
  tooShallow: 0, shallowest: null, events: [], legs: [{ name: 'Kanal', distance: 1300 }],
  start: { geom: 0, seg: 0, lat: 0, lon: 0, offset: 0, frac: 0 }, end: { geom: 0, seg: 0, lat: 0, lon: 1, offset: 0, frac: 0 },
} as Route;

describe('routeNotices', () => {
  it('has nothing to say about a plain route', () => {
    expect(routeNotices(route, defaultProfile, [])).toEqual([]);
  });

  it('groups waterway issues by kind, the most serious first', () => {
    const banned = { ...kanal, id: 'b', name: 'Quiet lake', airDraftM: null, depth: { ...kanal.depth, maxDraftM: null }, rules: { motorboats: 'banned' } } as typeof kanal;
    const tall = { ...defaultProfile, draft: 2, airDraft: 3.8 };
    const n = routeNotices(route, tall, [restricted, kanal, empty, banned]);
    expect(n.map((x) => [x.level, x.title])).toEqual([
      ['error', 'Bare canal is closed'],
      ['error', 'Too shallow for 2 m draft on Kanal (A – B)'],
      ['warn', 'Motorboats not allowed on Quiet lake'],
      ['warn', 'Navigation restricted on Low canal'],
      ['warn', 'Little room under the bridges of Kanal (A – B)'],
    ]);
    expect(n[0].detail).toBe('Bare canal: closed as of 2026-11-21, see About the waterways.');
    const two = routeNotices(route, { ...defaultProfile, airDraft: 9 }, [kanal, { ...kanal, name: 'Other' }, empty, { ...empty, name: 'Shut' }]);
    expect(two[0]).toEqual({ level: 'error', title: '2 waterways closed', detail: 'Bare canal, Shut', items: ['Bare canal: closed as of 2026-11-21, see About the waterways.', 'Shut: closed as of 2026-11-21, see About the waterways.'] });
    expect(two[1].title).toBe('Bridges too low for 9 m air draft on 2 waterways');
    const many = routeNotices(route, { ...defaultProfile, draft: 2, airDraft: 3.8 }, [kanal, { ...kanal, name: 'K2' }, banned, { ...banned, name: 'L2' }, restricted, { ...restricted, name: 'R2' }]);
    expect(many.map((x) => x.title)).toEqual(['Too shallow for 2 m draft on 2 waterways', 'Motorboats not allowed on 2 waterways',
      'Navigation restricted on 2 waterways', 'Little room under the bridges of 2 waterways']);
  });

  it('sums up the season for the dates, with the advice on when to go', () => {
    const n = routeNotices(route, { ...defaultProfile, departure: '2026-08-01' }, []);
    expect(n).toHaveLength(1);
    expect(n[0].title).toBe('1 seasonal note for your dates');
    expect(n[0].items![0]).toMatch(/^Kanal \(A – B\), reached around 2026-08-01: usually closed/);
    expect(n[0].detail).toMatch(/^All the waterways of this route are usually open and free of ice in/);
    // low water only: still when the route's waterways are usually open
    const low = routeNotices(route, { ...defaultProfile, departure: '2026-06-01' }, []);
    expect(low[0]).toMatchObject({ title: '1 seasonal note for your dates' });
    expect(low[0].detail).toMatch(/^All the waterways of this route are usually open and free of ice in .*[^:]$/);
  });

  it('gives no advice on when to go where no waterway is ever closed', () => {
    const n = routeNotices({ ...route, legs: [{ name: 'Rzeka', distance: 1300 }] }, { ...defaultProfile, departure: '2026-06-01' }, []);
    expect(n[0]).toMatchObject({ title: '1 seasonal note for your dates', detail: undefined });
  });

  it('notes motorboat bans, shallow sea, open sea, unverified links and moved ends', () => {
    const n = routeNotices({ ...route, noMotor: 900, tooShallow: 3000, sea: 3704, unverified: 400, start: { ...route.start, offset: 300 }, end: { ...route.end, offset: 2500 } }, defaultProfile, []);
    expect(n.map((x) => [x.level, x.title])).toEqual([
      ['warn', '0.9 km where motorboats may not be allowed'],
      ['warn', '3 km charted shallower than your draft'],
      ['info', '2.0 NM on open sea'],
      ['info', '0.4 km on unverified connections'],
      ['info', 'Start or end moved to navigable water'],
    ]);
    expect(n[2].detail).toBe('Check the weather, tides, traffic schemes and official charts before going.');
    expect(n[4].detail).toBe('Nearest navigable water: the start 0.3 km away, the end 2.5 km away.');
    const end = routeNotices({ ...route, end: { ...route.end, offset: 2500 } }, defaultProfile, []);
    expect(end[0].detail).toBe('Nearest navigable water: the end 2.5 km away.');
  });
});
