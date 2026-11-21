import { describe, expect, it, vi } from 'vitest';
import type { Itinerary } from '../routing/itinerary';
import { defaultProfile, type Route } from '../routing/router';
import type { Poi } from '../routing/service';
import { restricted } from '../test/waterwayFixture';
import { briefMarkdown, buildBrief, EDIT_PARAMETERS } from './brief';
import { VESSEL_PARAMS } from './urlState';

vi.mock('../data/waterways.json', async () => ({ default: [(await import('../test/waterwayFixture')).kanal] }));

const snap = { geom: 0, seg: 0, lat: 0, lon: 0, offset: 0, frac: 0 };
// 200 km in 20 h (10 km/h): three days of 8 h
const route: Route = {
  coordinates: [[0, 0], [1, 0]], distance: 200_000, duration: 72_000, locks: 1, unverified: 500, sea: 18_520, seaNoDepth: 9_260, offshore: 0, noMotor: 0, downstream: 150_000, upstream: 0, tooShallow: 0, shallowest: { draft: 1.4, at: 180_000 },
  events: [], legs: [{ name: 'Wisła', distance: 150_000 }, { name: '', distance: 50_000 }],
  start: snap, end: { ...snap, offset: 700 },
};
const stop = (at: number, poi: Partial<Poi>, offset = 0) => ({ at, offset, poi: { type: 'marina', name: '', lat: 1, lon: 2, ...poi } as Poi });
const itinerary: Itinerary = {
  counts: {},
  stops: [
    stop(10_000, { type: 'place', name: 'Toruń', cc: 'PL' }, 1500),
    stop(20_000, { type: 'lock', name: 'Śluza Włocławek', maxlength: 8, maxwidth: 2.5 }),
    stop(30_000, { type: 'bridge', clearance: 2.5 }),
    stop(40_000, { type: 'bridge', clearance: 9 }),
    stop(70_000, { type: 'marina', name: 'Przystań' }),   // 70 km: inside the last fifth of day 1 (64–80 km)
    stop(150_000, { type: 'place', name: 'Grudziądz' }),  // day 2 ends at km 150 without a marina: near the town
    stop(155_000, { type: 'port', name: 'A | B' }),       // after day 2's end
  ],
};

describe('route brief', () => {
  const b = buildBrief({ route, itinerary, profile: { ...defaultProfile, length: 9, beam: 3, airDraft: 3 }, title: 'Warsaw → Gdańsk', link: 'https://x/?from=1,2' });

  it('sums up the route and checks the vessel against locks and bridges', () => {
    expect(b.totals).toEqual({ km: 200, nm: 108, hours: 20, movingHours: 20, lockHours: 0.3, currentHours: -0.3, days: 3, locks: 1, seaNm: 10, seaNoDepthNm: 5, unverifiedKm: 0.5, tooShallowKm: 0, maxSeaDraftM: 1.4, downstreamKm: 150, upstreamKm: 0 });
    expect(b.legs).toEqual([
      { name: 'Wisła', fromKm: 0, toKm: 150, km: 150 },
      { name: 'unnamed waterway', fromKm: 150, toKm: 200, km: 50 },
    ]);
    expect(b.places).toEqual(['Toruń', 'Grudziądz']);
    expect(b.stops[0]).toEqual({ km: 10, type: 'place', name: 'Toruń', offKm: 1.5, lat: 1, lon: 2 });
    expect(b.stops[1].problem).toBe('vessel length 9 m exceeds chamber 8 m');
    expect(b.hazards.at(-1)).toBe("Today's closures, water levels and lock hours are not live here: check the notices to skippers for this route before going:"
      + ' PL Wody Polskie, komunikaty nawigacyjne (https://www.gov.pl/web/wody-polskie).');
    expect(b.stops[2].problem).toBe('air draft 3 m vs clearance 2.5 m');
    expect(b.stops[3].problem).toBeUndefined();
    expect(b.hazards.join('\n')).toMatch(/10 NM on open sea[\s\S]*km 180: charted depth allows about 1.4 m draft \(yours is 1 m\)[\s\S]*5 NM of open sea with depth unknown[\s\S]*0.5 km on unverified[\s\S]*0 km \/ 0.7 km away[\s\S]*km 20 Lock Śluza Włocławek[\s\S]*km 30 Bridge: air draft[\s\S]*notices to skippers/);
    const narrow = buildBrief({ route, itinerary, profile: { ...defaultProfile, length: 5, beam: 3 }, title: '', link: '' });
    expect(narrow.stops[1].problem).toBe('beam 3 m exceeds chamber width 2.5 m');
  });

  it('splits the trip into days ending at marinas or near towns', () => {
    expect(b.stages).toEqual([
      { day: 1, fromKm: 0, toKm: 70, km: 70, hours: 7, endsAt: 'Marina Przystań' },
      { day: 2, fromKm: 70, toKm: 150, km: 80, hours: 8, endsAt: 'km 150 (near Grudziądz)' },
      { day: 3, fromKm: 150, toKm: 200, km: 50, hours: 5, endsAt: 'destination' },
    ]);
    const plain = buildBrief({ route: { ...route, sea: 0, seaNoDepth: 0, unverified: 0, end: snap, shallowest: null }, itinerary: { counts: {}, stops: [] }, profile: defaultProfile, title: 't', link: 'l' });
    expect(plain.stages.map((s) => s.endsAt)).toEqual(['km 80', 'km 160', 'destination']);
    expect(plain.hazards).toHaveLength(1);
    expect(plain.totals.maxSeaDraftM).toBeNull();
    const deep = buildBrief({ route: { ...route, shallowest: { draft: 8, at: 0 } }, itinerary, profile: defaultProfile, title: 't', link: 'l' });
    expect(deep.hazards.find((h) => h.includes('Shallowest'))).not.toContain('yours');
    const aground = buildBrief({ route: { ...route, tooShallow: 3_000 }, itinerary, profile: { ...defaultProfile, draft: 2 }, title: 't', link: 'l' });
    expect(aground.totals.tooShallowKm).toBe(3);
    const banned = buildBrief({ route: { ...route, noMotor: 2_000 }, itinerary, profile: defaultProfile, title: 't', link: 'l' });
    expect(banned.hazards.some((h) => h.startsWith('2 km on waters where OpenStreetMap says motorboats are not allowed'))).toBe(true);
    expect(aground.hazards.find((h) => h.startsWith('3 km of open sea'))).toContain('shallower than your 2 m draft');
    const unnamed = buildBrief({ route, itinerary: { counts: {}, stops: [stop(75_000, { type: 'port' })] }, profile: defaultProfile, title: 't', link: 'l' });
    expect(unnamed.stages[0].endsAt).toBe('Port');
    const still = buildBrief({ route: { ...route, duration: 0 }, itinerary, profile: defaultProfile, title: 't', link: 'l' });
    expect(still.stages).toHaveLength(1);
  });

  it('never ends a day out at sea', () => {
    // 100 km river, then a 300 km sea passage, 10 km/h: days of 80 km
    const seaRoute: Route = { ...route, distance: 400_000, duration: 144_000, legs: [{ name: 'Rhône', distance: 100_000 }, { name: 'Open sea', distance: 300_000 }] };
    const open = buildBrief({ route: seaRoute, itinerary: { counts: {}, stops: [stop(95_000, { type: 'port', name: 'Port-Saint-Louis' })] }, profile: defaultProfile, title: 't', link: 'l' });
    // day 2 would end 60 km out: it ends at the last harbour before the passage instead
    expect(open.stages.map((s) => [s.toKm, s.endsAt])).toEqual([[80, 'km 80'], [95, 'Port Port-Saint-Louis'], [400, 'destination']]);
    expect(open.stages[2]).toMatchObject({ km: 305, atSea: true });
    expect(open.totals.days).toBe(3);
    expect(open.hazards.find((h) => h.startsWith('km 95–400'))).toContain('164.7 NM of open sea with no harbour on the planned line, about 31 h non-stop');
    // a harbour out on the passage (an island) breaks it up; a passage ending before the destination is named so
    const island = buildBrief({ route: { ...seaRoute, legs: [...seaRoute.legs.slice(0, 1), { name: 'Open sea', distance: 200_000 }, { name: 'Port', distance: 100_000 }] },
      itinerary: { counts: {}, stops: [stop(180_000, { type: 'marina', name: 'Île' })] }, profile: defaultProfile, title: 't', link: 'l' });
    expect(island.stages.map((s) => s.endsAt)).toEqual(['km 80', 'Marina Île', 'km 300, end of the sea passage', 'km 380', 'destination']);
  });

  it('names unnamed harbours by type and shows time lost to the current', () => {
    const seaRoute: Route = { ...route, distance: 400_000, duration: 180_000, legs: [{ name: 'Rhône', distance: 100_000 }, { name: 'Open sea', distance: 300_000 }] };
    const at = (stops: Itinerary['stops']) => buildBrief({ route: seaRoute, itinerary: { counts: {}, stops }, profile: defaultProfile, title: 't', link: 'l' });
    expect(at([stop(95_000, { type: 'port' })]).stages[1].endsAt).toBe('Port');
    expect(at([stop(250_000, { type: 'marina' })]).stages.map((x) => x.endsAt)).toContain('Marina');
    expect(briefMarkdown(at([]))).toContain('current +9.7 h');
  });

  it('renders Markdown with edit instructions for AI assistants', () => {
    const md = briefMarkdown(b);
    expect(md).toContain('# Route: Warsaw → Gdańsk');
    expect(md).toContain('Open or edit: https://x/?from=1,2');
    expect(md).toContain('- Open sea: 10 NM');
    expect(md).toContain('- River current: 0.5 m/s, 150 km with it, 0 km against it');
    expect(md).toContain('in 3 day(s) of up to 8 h: moving 20 h, locks 0.3 h (20 min each), current -0.3 h');
    expect(md).toContain('Draft 1 m (default, not entered), air draft 3 m (default, not entered), beam 3 m, length 9 m (default, not entered)');
    expect(md).toContain('- Towns on the way: Toruń, Grudziądz');
    expect(md).toContain('| 0–150 | Wisła | 150 km |');
    expect(md).toContain('| 1 | 0–70 | 70 km | 7 h | Marina Przystań |');
    expect(md).toContain('| 20 | Lock | Śluza Włocławek | 8 × 2.5 m; ⚠ vessel length 9 m exceeds chamber 8 m |');
    expect(md).toContain('| 155 | Port | A / B |  |');
    expect(md).toContain('- `via`: waypoints in order');
    const quiet = briefMarkdown({ ...b, places: [], totals: { ...b.totals, seaNm: 0, downstreamKm: 0 }, vessel: { ...b.vessel, avoidLocks: true, avoidSea: true } });
    expect(quiet).not.toContain('Open sea:');
    expect(quiet).not.toContain('River current');
    expect(quiet).not.toContain('Towns on the way');
    expect(quiet).toContain('avoiding locks where possible, avoiding open sea.');
    expect(briefMarkdown({ ...b, vessel: { ...b.vessel, coastal: true } })).toContain(', keeping near the coast.');
  });

  it('names coordinate endpoints after the nearest town', () => {
    const coords = '52.2500°N 21.0300°E → 54.3500°N 18.6600°E';
    const named = (title: string) => buildBrief({ route, itinerary, profile: defaultProfile, title, link: '' }).title;
    expect(named(coords)).toBe('Toruń → 54.3500°N 18.6600°E'); // Toruń 10 km from the start; nothing near the end
    expect(named('Home → 54.3500°N 18.6600°E')).toBe('Home → 54.3500°N 18.6600°E');
    expect(named('no arrow')).toBe('no arrow');
    const two = { counts: {}, stops: [stop(8000, { type: 'place', name: 'Dalej' }), stop(3000, { type: 'place', name: 'Bliżej' })] };
    expect(buildBrief({ route, itinerary: two, profile: defaultProfile, title: coords, link: '' }).title).toMatch(/^Bliżej → /);
  });

  it('documents every URL parameter', () => {
    for (const k of [...Object.keys(VESSEL_PARAMS), 'from', 'to', 'via', 'avoidLocks', 'avoidSea', 'coastal']) expect(EDIT_PARAMETERS[k]).toBeTruthy();
  });

  it('describes the researched waterways on the route and warns where the boat does not fit', () => {
    const onKanal = buildBrief({ route: { ...route, legs: [{ name: 'Kanal', distance: 200_000 }] }, itinerary, profile: { ...defaultProfile, draft: 2 },
      title: 't', link: 'l' });
    expect(onKanal.waterways.map((w) => w.id)).toEqual(['kanal']);
    expect(onKanal.hazards).toContain('Kanal (A – B): draft 2 m exceeds the usual 1.5 m.');
    const md = briefMarkdown(onKanal);
    expect(md).toContain('## Waterways\n\n### Kanal (A – B) (seasonal)\nA to B\n- Gauge: Vb');
    expect(md).toContain('- Locks: 3; 190 × 12 m; 6–22');
    expect(md).toContain('- Tides: tidal, spring range about 0.3 m: to the first lock');
    expect(md).toContain('- By month: usually closed Jul–Oct; low water Jun; high water Feb–Mar; ice Jan. summit pound short of water');
    const dated = buildBrief({ route: { ...route, legs: [{ name: 'Kanal', distance: 200_000 }] }, itinerary, profile: { ...defaultProfile, departure: '2027-08-01' },
      title: 't', link: 'l' });
    expect(dated.stages.map((s) => s.date)).toEqual(['2027-08-01', '2027-08-02', '2027-08-03']);
    expect(dated.hazards).toContain('Kanal (A – B), reached around 2027-08-01: usually closed in August (summit pound short of water).');
    expect(briefMarkdown(dated)).toContain('| 1 (2027-08-01) | 0–70 |');
    expect(md).toContain('- Authority: WSA (https://www.wsa.example)');
    expect(md).toContain('- Sources (checked 2026-11-21): https://www.elwis.de/a, https://de.wikipedia.org/wiki/Kanal');
    expect(briefMarkdown({ ...onKanal, waterways: [restricted] })).toContain('- Authority: Nobody\n- Notes: until 30 November');
    expect(briefMarkdown(b)).not.toContain('## Waterways');
  });
});
