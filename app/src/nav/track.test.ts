import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Fix } from './progress';
import { addFix, loadTrack, MAX_POINTS, saveTrack, TRACK_KEY, trackGpx } from './track';

const fix = (lon: number, lat: number, time = 0, accuracy = 5): Fix => ({ lon, lat, time, accuracy, speed: null, heading: null });

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('track', () => {
  it('adds a point once the boat has moved', () => {
    const a = addFix([], fix(21, 52, 1));
    expect(a).toEqual([{ lon: 21, lat: 52, time: 1 }]);
    expect(addFix(a, fix(21, 52.00005, 2))).toBe(a); // 5 m
    expect(addFix(a, fix(21, 52.0002, 3, 50))).toBe(a); // 22 m but a 50 m fix
    expect(addFix(a, fix(21, 52.0002, 3))).toHaveLength(2);
  });

  it('keeps the newest points when full', () => {
    const full = Array.from({ length: MAX_POINTS }, (_, i) => ({ lon: 0, lat: i * 0.001, time: i }));
    const next = addFix(full, fix(1, 1, 99));
    expect(next).toHaveLength(MAX_POINTS);
    expect(next.at(-1)).toEqual({ lon: 1, lat: 1, time: 99 });
    expect(next[0].time).toBe(1);
  });

  it('is stored and read back, and cleared', () => {
    expect(loadTrack()).toEqual([]);
    saveTrack([{ lon: 1, lat: 2, time: 3 }]);
    expect(loadTrack()).toEqual([{ lon: 1, lat: 2, time: 3 }]);
    saveTrack([]);
    expect(localStorage.getItem(TRACK_KEY)).toBeNull();
    localStorage.setItem(TRACK_KEY, '{"not":"a list"}');
    expect(loadTrack()).toEqual([]);
    localStorage.setItem(TRACK_KEY, 'not json');
    expect(loadTrack()).toEqual([]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('full'); });
    expect(() => saveTrack([{ lon: 1, lat: 2, time: 3 }])).not.toThrow();
  });

  it('exports GPX', () => {
    const gpx = trackGpx([{ lon: 13.95, lat: 52.85, time: Date.UTC(2026, 5, 1, 10) }], 'Liepe & back <1>');
    expect(gpx).toContain('<name>Liepe &amp; back &lt;1></name>');
    expect(gpx).toContain('<trkpt lat="52.850000" lon="13.950000"><time>2026-06-01T10:00:00.000Z</time></trkpt>');
    expect(trackGpx([])).toContain('<name>Interway track</name>');
  });
});
