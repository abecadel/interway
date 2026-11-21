import { describe, expect, it } from 'vitest';
import { bearing } from '../graph/geo';
import type { Stop } from '../routing/itinerary';
import type { Route } from '../routing/router';
import { alongOf, buildTrack, fixOf, isNewAnchor, motionOf, OFF_COUNT, trackProgress, type Fix } from './progress';

const route = (coordinates: [number, number][], over: Partial<Route> = {}): Route => ({
  coordinates, distance: 0, duration: 3600, locks: 0, unverified: 0, sea: 0, seaNoDepth: 0, offshore: 0, noMotor: 0, downstream: 0, upstream: 0, tooShallow: 0, shallowest: null,
  events: [], legs: [], start: { offset: 0 } as never, end: { offset: 0 } as never, ...over,
});
const fix = (lon: number, lat: number, over: Partial<Fix> = {}): Fix => ({ lon, lat, accuracy: 10, speed: null, heading: null, time: 0, ...over });
const stop = (type: Stop['poi']['type'], name: string, at: number): Stop => ({ poi: { type, name, lat: 0, lon: 0 }, at, offset: 0 });

// 21.0 -> 21.1 at 52 N is about 6.85 km
const straight = route([[21, 52], [21.05, 52], [21.1, 52]], { events: [{ type: 'lock', name: 'Graph lock', lat: 52, lon: 21.08, at: 5500 }] });

describe('buildTrack', () => {
  it('measures the line, merges POI and graph locks and ends with the destination', () => {
    const t = buildTrack(straight, [stop('lock', 'Śluza', 2000), stop('bridge', 'Most', 3000), stop('marina', 'Port', 1000), stop('lock', 'Twin', 5450)]);
    expect(t.total).toBeCloseTo(6850, -2);
    expect(t.secPerM).toBeCloseTo(3600 / t.total);
    expect(t.events.map((e) => e.name)).toEqual(['Śluza', 'Most', 'Twin', '']);
    expect(t.events.at(-1)!.kind).toBe('end');
    const g = buildTrack(straight, []);
    expect(g.events.map((e) => e.name)).toEqual(['Graph lock', '']);
    expect(buildTrack(route([[21, 52]]), []).secPerM).toBe(0);
  });
});

describe('trackProgress', () => {
  const t = buildTrack(straight, [stop('lock', 'Śluza', 2000), stop('bridge', 'Most', 3000)]);

  it('gives the distance along, the side of the line, the next events and the ETA', () => {
    const p = trackProgress(t, fix(21.02, 52.0005), null);
    expect(p.along).toBeCloseTo(1370, -1);
    expect(p.crossTrack).toBeCloseTo(56, 0);
    expect(p.side).toBe('left'); // north of an eastbound line
    expect(trackProgress(t, fix(21.02, 51.9995), null).side).toBe('right');
    expect(trackProgress(t, fix(21.02, 52.00001), null).side).toBeNull(); // on the line
    expect(p.next).toMatchObject({ kind: 'lock', name: 'Śluza' });
    expect(p.next!.distance).toBeCloseTo(630, -1);
    expect(p.upcoming.map((e) => e.name)).toEqual(['Śluza', 'Most', 'Graph lock']);
    expect(p.remaining).toBeCloseTo(t.total - p.along);
    expect(p.eta).toBeCloseTo(p.remaining * t.secPerM);
    expect(p.offRoute).toBe(false);
    expect(p.arrived).toBe(false);
  });

  it('uses the measured speed for the ETA when under way', () => {
    const p = trackProgress(t, fix(21.02, 52), null, { sog: 4, cog: 90 });
    expect(p.eta).toBeCloseTo(p.remaining / ((t.total / 3600 + 4) / 2));
    expect(trackProgress(t, fix(21.02, 52), null, { sog: 0.2, cog: null }).eta).toBeCloseTo(p.remaining * t.secPerM);
  });

  it('arrives near the end and has nothing next past it', () => {
    const p = trackProgress(t, fix(21.0995, 52), null);
    expect(p.arrived).toBe(true);
    expect(p.next).toMatchObject({ kind: 'end' });
    const past = trackProgress(t, fix(21.2, 52), null);
    expect(past.next).toBeNull();
    expect(past.remaining).toBe(0);
  });

  it('is off the route only after several fixes in a row', () => {
    let p = trackProgress(t, fix(21.02, 52.005), null);
    for (let i = 1; i < OFF_COUNT; i++) {
      expect(p.offRoute).toBe(false);
      p = trackProgress(t, fix(21.02, 52.005), p);
    }
    expect(p.offRoute).toBe(true);
    expect(p.offCount).toBe(OFF_COUNT);
    expect(trackProgress(t, fix(21.02, 52), p).offCount).toBe(0);
    // a poor fix is not off the route just because its accuracy is large
    expect(trackProgress(t, fix(21.02, 52.002, { accuracy: 300 }), null).offCount).toBe(0);
  });

  it('expects the boat off the line near the start of a route planned from where it is', () => {
    // planned from 400 m north of the canal: the route starts on the canal
    const from = buildTrack(route([[21, 52], [21.1, 52]], { start: { offset: 400 } as never }), []);
    let p = trackProgress(from, fix(21.001, 52.0036), null);
    for (let i = 0; i < OFF_COUNT; i++) p = trackProgress(from, fix(21.001, 52.0036), p);
    expect(p.crossTrack).toBeCloseTo(400, -1);
    expect(p.offRoute).toBe(false);
    // further along, the same distance off is off the route again
    p = null as never;
    for (let i = 0; i < OFF_COUNT; i++) p = trackProgress(from, fix(21.05, 52.0036), p);
    expect(p.offRoute).toBe(true);
  });

  it('keeps to the stretch it is on where the route runs back alongside itself', () => {
    // out east and back west 55 m to the north
    const loop = buildTrack(route([[21, 52], [21.05, 52], [21.05, 52.0005], [21, 52.0005]]), []);
    const back = trackProgress(loop, fix(21.04, 52.0005), null);
    expect(back.along).toBeGreaterThan(3500);
    // between the two stretches: nearer the outward one, but the boat is on its way back
    const mid = trackProgress(loop, fix(21.03, 52.0002), back);
    expect(mid.along).toBeGreaterThan(back.along);
    expect(trackProgress(loop, fix(21.03, 52.0002), null).along).toBeLessThan(3500);
    // far from both: searched over the whole line
    expect(trackProgress(loop, fix(21.001, 52.0001), { ...back, along: 100_000 }).along).toBeLessThan(200);
  });

  it('copes with a route of a single point', () => {
    const one = buildTrack(route([[21, 52]], { duration: 0 }), []);
    const p = trackProgress(one, fix(21.001, 52), null);
    expect(p.along).toBe(0);
    expect(p.crossTrack).toBeCloseTo(68, 0);
    expect(trackProgress(one, fix(21.001, 52), p).along).toBe(0);
  });

  it('finds where a waypoint is along the track', () => {
    expect(alongOf(t, [21.05, 52.001])).toBeCloseTo(3425, -1);
  });
});

describe('motion', () => {
  it('takes the device speed and heading when there are any', () => {
    expect(motionOf(fix(21, 52, { speed: 3, heading: 45 }), null)).toEqual({ sog: 3, cog: 45 });
    // standing still: a heading means nothing
    expect(motionOf(fix(21, 52, { speed: 0, heading: 45 }), null)).toEqual({ sog: 0, cog: null });
    expect(motionOf(fix(21, 52, { speed: null, heading: Number.NaN }), null)).toEqual({ sog: null, cog: null });
  });

  it('works them out from an earlier fix far enough away', () => {
    const a = fix(21, 52, { time: 0 });
    const m = motionOf(fix(21, 52.001, { time: 50_000 }), a); // 111 m north in 50 s
    expect(m.sog).toBeCloseTo(111.2 / 50, 1);
    expect(m.cog).toBeCloseTo(0, 0);
    expect(motionOf(fix(21, 52.00003, { time: 5000 }), a)).toEqual({ sog: null, cog: null }); // 3 m: noise
    expect(motionOf(fix(21, 52.001, { time: 0 }), a)).toEqual({ sog: null, cog: null });
    expect(motionOf(fix(21, 52.1, { time: 2000 }), a)).toEqual({ sog: null, cog: null }); // 11 km in 2 s
    expect(motionOf(fix(21, 52.001, { time: 50_000, speed: 1 }), a)).toEqual({ sog: 1, cog: expect.closeTo(0, 0) });
  });

  it('moves the anchor once the boat has gone far enough or a while has passed', () => {
    const a = fix(21, 52, { time: 0 });
    expect(isNewAnchor(a, null)).toBe(true);
    expect(isNewAnchor(fix(21, 52.0001, { time: 1000 }), a)).toBe(false);
    expect(isNewAnchor(fix(21, 52.001, { time: 1000 }), a)).toBe(true);
    expect(isNewAnchor(fix(21, 52.0001, { time: 31_000 }), a)).toBe(true);
  });

  it('reads a browser position', () => {
    const p = { coords: { longitude: 21, latitude: 52, accuracy: 8, speed: null, heading: null }, timestamp: 7 } as unknown as GeolocationPosition;
    expect(fixOf(p)).toEqual({ lon: 21, lat: 52, accuracy: 8, speed: null, heading: null, time: 7 });
    const bare = { coords: { longitude: 21, latitude: 52 }, timestamp: 7 } as unknown as GeolocationPosition;
    expect(fixOf(bare)).toMatchObject({ accuracy: 0, speed: null, heading: null });
  });

  it('measures bearings clockwise from north', () => {
    expect(bearing(52, 21, 52, 21.1)).toBeCloseTo(90, 0);
    expect(bearing(52, 21, 51.9, 21)).toBeCloseTo(180, 0);
    expect(bearing(52, 21, 52, 20.9)).toBeCloseTo(270, 0);
  });
});
