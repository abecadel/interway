import { describe, expect, it } from 'vitest';
import type { Itinerary } from '../routing/itinerary';
import { defaultProfile, type Route } from '../routing/router';
import type { Poi } from '../routing/service';
import { briefMarkdown, buildBrief, EDIT_PARAMETERS } from './brief';
import { VESSEL_PARAMS } from './urlState';

const snap = { geom: 0, seg: 0, lat: 0, lon: 0, offset: 0, frac: 0 };
// 200 km in 20 h (10 km/h): three days of 8 h
const route: Route = {
  coordinates: [[0, 0], [1, 0]], distance: 200_000, duration: 72_000, locks: 1, unverified: 500, sea: 18_520,
  events: [], legs: [{ name: 'Wisła', distance: 150_000 }, { name: '', distance: 50_000 }],
  start: snap, end: { ...snap, offset: 700 },
};
const stop = (at: number, poi: Partial<Poi>, offset = 0) => ({ at, offset, poi: { type: 'marina', name: '', lat: 1, lon: 2, ...poi } as Poi });
const itinerary: Itinerary = {
  counts: {},
  stops: [
    stop(10_000, { type: 'place', name: 'Toruń' }, 1500),
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
    expect(b.totals).toEqual({ km: 200, nm: 108, hours: 20, days: 3, locks: 1, seaNm: 10, unverifiedKm: 0.5 });
    expect(b.legs).toEqual([
      { name: 'Wisła', fromKm: 0, toKm: 150, km: 150 },
      { name: 'unnamed waterway', fromKm: 150, toKm: 200, km: 50 },
    ]);
    expect(b.places).toEqual(['Toruń', 'Grudziądz']);
    expect(b.stops[0]).toEqual({ km: 10, type: 'place', name: 'Toruń', offKm: 1.5, lat: 1, lon: 2 });
    expect(b.stops[1].problem).toBe('vessel length 9 m exceeds chamber 8 m');
    expect(b.stops[2].problem).toBe('air draft 3 m vs clearance 2.5 m');
    expect(b.stops[3].problem).toBeUndefined();
    expect(b.hazards.join('\n')).toMatch(/10 NM on open sea[\s\S]*0.5 km on unverified[\s\S]*0 km \/ 0.7 km away[\s\S]*km 20 Lock Śluza Włocławek[\s\S]*km 30 Bridge: air draft[\s\S]*notices to skippers/);
    const narrow = buildBrief({ route, itinerary, profile: { ...defaultProfile, length: 5, beam: 3 }, title: '', link: '' });
    expect(narrow.stops[1].problem).toBe('beam 3 m exceeds chamber width 2.5 m');
  });

  it('splits the trip into days ending at marinas or near towns', () => {
    expect(b.stages).toEqual([
      { day: 1, fromKm: 0, toKm: 70, km: 70, hours: 7, endsAt: 'Marina Przystań' },
      { day: 2, fromKm: 70, toKm: 150, km: 80, hours: 8, endsAt: 'km 150 (near Grudziądz)' },
      { day: 3, fromKm: 150, toKm: 200, km: 50, hours: 5, endsAt: 'destination' },
    ]);
    const plain = buildBrief({ route: { ...route, sea: 0, unverified: 0, end: snap }, itinerary: { counts: {}, stops: [] }, profile: defaultProfile, title: 't', link: 'l' });
    expect(plain.stages.map((s) => s.endsAt)).toEqual(['km 80', 'km 160', 'destination']);
    expect(plain.hazards).toHaveLength(1);
    const unnamed = buildBrief({ route, itinerary: { counts: {}, stops: [stop(75_000, { type: 'port' })] }, profile: defaultProfile, title: 't', link: 'l' });
    expect(unnamed.stages[0].endsAt).toBe('Port');
    const still = buildBrief({ route: { ...route, duration: 0 }, itinerary, profile: defaultProfile, title: 't', link: 'l' });
    expect(still.stages).toHaveLength(1);
  });

  it('renders Markdown with edit instructions for AI assistants', () => {
    const md = briefMarkdown(b);
    expect(md).toContain('# Route: Warsaw → Gdańsk');
    expect(md).toContain('Open or edit: https://x/?from=1,2');
    expect(md).toContain('- Open sea: 10 NM');
    expect(md).toContain('- Towns on the way: Toruń, Grudziądz');
    expect(md).toContain('| 0–150 | Wisła | 150 km |');
    expect(md).toContain('| 1 | 0–70 | 70 km | 7 h | Marina Przystań |');
    expect(md).toContain('| 20 | Lock | Śluza Włocławek | 8 × 2.5 m; ⚠ vessel length 9 m exceeds chamber 8 m |');
    expect(md).toContain('| 155 | Port | A / B |  |');
    expect(md).toContain('- `via`: waypoints in order');
    const quiet = briefMarkdown({ ...b, places: [], totals: { ...b.totals, seaNm: 0 }, vessel: { ...b.vessel, avoidLocks: true } });
    expect(quiet).not.toContain('Open sea:');
    expect(quiet).not.toContain('Towns on the way');
    expect(quiet).toContain('avoiding locks where possible');
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
    for (const k of [...Object.keys(VESSEL_PARAMS), 'from', 'to', 'via', 'avoidLocks']) expect(EDIT_PARAMETERS[k]).toBeTruthy();
  });
});
