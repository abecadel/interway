import { describe, expect, it } from 'vitest';
import type { Route } from '../routing/router';
import { fmtDuration, fmtKm, fmtNm, fmtPos, poiDetail, toGpx } from './format';

describe('formatting', () => {
  it('distances', () => {
    expect(fmtKm(1234)).toBe('1.2 km');
    expect(fmtKm(123_456)).toBe('123 km');
    expect(fmtNm(1852 * 2.5)).toBe('2.5 NM');
  });

  it('durations', () => {
    expect(fmtDuration(59 * 60)).toBe('59 min');
    expect(fmtDuration(3600 * 2 + 600)).toBe('2 h 10 min');
    expect(fmtDuration(3600 * 27)).toBe('1 d 3 h');
    expect(fmtDuration(3600 + 59.6 * 60)).toBe('2 h 0 min');
  });

  it('positions in all hemispheres', () => {
    expect(fmtPos([21.03, 52.47])).toBe('52.4700°N 21.0300°E');
    expect(fmtPos([-70.5, -33.25])).toBe('33.2500°S 70.5000°W');
  });

  it('GPX with escaped names', () => {
    const route = {
      coordinates: [[21, 52], [21.1, 52.1]],
      events: [{ type: 'lock', name: 'A & <B>', lat: 52.05, lon: 21.05, at: 1 }],
    } as unknown as Route;
    const gpx = toGpx(route, 'X "Y"');
    expect(gpx).toContain('<name>A &#38; &#60;B&#62;</name>');
    expect(gpx).toContain('<name>X &#34;Y&#34;</name>');
    expect(gpx).toContain('<rtept lat="52.100000" lon="21.100000"/>');
    expect(toGpx({ ...route, events: [] })).toContain('<name>Interway route</name>');
  });

  it('GPX waypoints from itinerary stops', () => {
    const route = { coordinates: [[21, 52]], events: [] } as unknown as Route;
    const gpx = toGpx(route, 'x', [
      { poi: { type: 'fuel', name: '', lat: 52.1, lon: 21.1 }, at: 0, offset: 0 },
      { poi: { type: 'marina', name: 'Port', lat: 52.2, lon: 21.2 }, at: 1, offset: 0 },
    ]);
    expect(gpx).toContain('<name>Fuel</name><type>fuel</type>');
    expect(gpx).toContain('<name>Port</name><type>marina</type>');
  });

  it('poi details', () => {
    expect(poiDetail({ type: 'bridge', name: '', lat: 0, lon: 0, clearance: 3 })).toBe('clearance 3.0 m');
    expect(poiDetail({ type: 'lock', name: '', lat: 0, lon: 0, maxlength: 40, maxwidth: 5 })).toBe('40 × 5 m');
    expect(poiDetail({ type: 'lock', name: '', lat: 0, lon: 0, maxlength: 40 })).toBe('');
  });
});
