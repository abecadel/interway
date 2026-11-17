import { describe, expect, it } from 'vitest';
import { buildItinerary, NEAR_M } from './itinerary';
import type { Route } from './router';
import type { Poi } from './service';

// a straight 2-segment route along the equator: 0 -> 0.1° (11.1 km) -> 0.2°
const route = { coordinates: [[0, 0], [0.1, 0], [0.2, 0]] } as unknown as Route;
const m = 1 / 111_195;

const poi = (over: Partial<Poi>): Poi => ({ type: 'fuel', name: '', lat: 0, lon: 0, ...over });

describe('buildItinerary', () => {
  it('orders stops by distance along the route and counts them', () => {
    const it = buildItinerary(route, [
      poi({ type: 'marina', name: 'Far end', lon: 0.15, lat: 100 * m }),
      poi({ type: 'lock', name: 'Śluza', lon: 0.05, lat: 10 * m, maxlength: 57, maxwidth: 9.6 }),
      poi({ type: 'fuel', name: 'Stacja', lon: 0.02, lat: -200 * m }),
      poi({ type: 'bridge', lon: 0.12, lat: 0, clearance: 4.2 }),
      poi({ type: 'bridge', lon: 0.13, lat: 0, clearance: 3.1 }),
      poi({ type: 'bridge', lon: 0.14, lat: 0 }), // clearance unknown
      poi({ type: 'place', name: 'Miasto', lon: 0.18, lat: 2500 * m }),
    ]);
    expect(it.stops.map((s) => s.poi.name || s.poi.type)).toEqual(['Stacja', 'Śluza', 'bridge', 'bridge', 'bridge', 'Far end', 'Miasto']);
    expect(it.stops[1].at).toBeCloseTo(5560, -1);
    expect(it.stops[0].offset).toBeCloseTo(200, 0);
    expect(it.counts).toEqual({ fuel: 1, lock: 1, bridge: 3, marina: 1, place: 1 });
    expect(it.minClearance).toBe(3.1);
  });

  it('skips points too far from the route', () => {
    const it = buildItinerary(route, [
      poi({ type: 'fuel', lon: 0.05, lat: (NEAR_M + 50) * m }),      // services: 300 m
      poi({ type: 'lock', lon: 0.05, lat: 100 * m }),                  // locks and bridges must be on the route
      poi({ type: 'marina', lon: 5, lat: 5 }),
      poi({ type: 'place', lon: 0.05, lat: 3500 * m }),                // towns: 3 km
    ]);
    expect(it.stops).toEqual([]);
    expect(it.minClearance).toBeUndefined();
  });

  it('handles empty input and degenerate routes', () => {
    expect(buildItinerary(route, []).stops).toEqual([]);
    const dot = { coordinates: [[0, 0]] } as unknown as Route;
    expect(buildItinerary(dot, [poi({})]).stops).toEqual([]);
  });

  it('searches wider in longitude at high latitudes', () => {
    const north = { coordinates: [[0, 70], [0.1, 70]] } as unknown as Route;
    expect(buildItinerary(north, [poi({ lon: 0.05, lat: 70 + 150 * m })]).stops).toHaveLength(1);
  });

  it('picks the nearest of several candidate segments', () => {
    // two points just past and just before the middle vertex: each is near both segments
    const a = poi({ name: 'after', lon: 0.1 + 20 * m, lat: 30 * m });
    const b = poi({ name: 'before', lon: 0.1 - 20 * m, lat: 30 * m });
    const it = buildItinerary(route, [a, b]);
    expect(it.stops.map((s) => s.poi.name)).toEqual(['before', 'after']);
    expect(it.stops.every((s) => Math.abs(s.offset - 30) < 1)).toBe(true);
  });

  it('merges the same thing mapped twice, keeping the named one', () => {
    const it = buildItinerary(route, [
      poi({ type: 'lock', name: '', lon: 0.05, lat: 0 }),
      poi({ type: 'lock', name: 'Pochylnia Kąty', lon: 0.0505, lat: 0 }),   // 55 m on: the same plane
      poi({ type: 'lock', name: '', lon: 0.051, lat: 0 }),                 // a third copy, unnamed
      poi({ type: 'marina', name: 'Port', lon: 0.05, lat: 50 * m }),       // another kind: kept
      poi({ type: 'lock', name: 'Next', lon: 0.06, lat: 0 }),              // 1.1 km on: another lock
      poi({ type: 'lock', name: 'Next', lon: 0.0601, lat: 0 }),            // same name, 11 m on: duplicate
      poi({ type: 'marina', name: 'Other', lon: 0.0502, lat: 50 * m }),    // differently named neighbour: kept
    ]);
    expect(it.stops.map((s) => `${s.poi.type}:${s.poi.name}`)).toEqual(
      ['lock:Pochylnia Kąty', 'marina:Port', 'marina:Other', 'lock:Next']);
    expect(it.counts).toEqual({ lock: 2, marina: 2 });
  });
});
