import { describe, expect, it } from 'vitest';
import { dayEvents, moonAltitude, moonPhase, solunar, sunAltitude } from './astro';

const utc = (s: string) => Date.parse(s);
const near = (t: number | null, s: string, minutes: number) => {
  expect(t).not.toBeNull();
  expect(Math.abs(t! - utc(s)) / 60_000).toBeLessThan(minutes);
};

describe('sun and moon', () => {
  it('gives Warsaw its midsummer sunrise and sunset', () => {
    const e = dayEvents(utc('2026-06-21T00:00:00Z'), 52.23, 21.01);
    near(e.sunrise, '2026-06-21T02:14:00Z', 8); // 04:14 local
    near(e.sunset, '2026-06-21T19:01:00Z', 8); // 21:01 local
  });

  it('knows the midnight sun and the polar night', () => {
    const summer = dayEvents(utc('2026-06-21T00:00:00Z'), 69.65, 18.96);
    expect([summer.sunrise, summer.sunset]).toEqual([null, null]);
    expect(sunAltitude(utc('2026-06-21T23:00:00Z'), 69.65, 18.96)).toBeGreaterThan(0);
    const winter = dayEvents(utc('2026-12-21T00:00:00Z'), 69.65, 18.96);
    expect([winter.sunrise, winter.sunset]).toEqual([null, null]);
  });

  it('gives the moon phase', () => {
    expect(moonPhase(utc('2024-01-25T17:54:00Z')).fraction).toBeGreaterThan(0.98);
    expect(moonPhase(utc('2024-01-25T17:54:00Z')).name).toBe('full moon');
    expect(moonPhase(utc('2024-01-11T11:57:00Z'))).toMatchObject({ name: 'new moon' });
    const fq = moonPhase(utc('2024-01-18T03:52:00Z'));
    expect(fq.fraction).toBeCloseTo(0.5, 1);
    expect(fq.waxing).toBe(true);
    expect(moonPhase(utc('2024-02-02T23:18:00Z'))).toMatchObject({ waxing: false }); // last quarter
    expect(moonPhase(utc('2024-01-14T12:00:00Z')).name).toBe('waxing crescent');
    expect(moonPhase(utc('2024-01-21T12:00:00Z')).name).toBe('waxing gibbous');
    expect(moonPhase(utc('2024-01-29T12:00:00Z')).name).toBe('waning gibbous');
    expect(moonPhase(utc('2024-02-06T12:00:00Z')).name).toBe('waning crescent');
    expect(moonPhase(utc('2024-02-02T23:18:00Z')).name).toBe('last quarter');
  });

  it("finds the moon's rise, set and transits, and the solunar periods around them", () => {
    const from = utc('2026-06-21T00:00:00Z');
    const e = dayEvents(from, 52.23, 21.01);
    expect(e.moonUpper).not.toBeNull();
    // the upper transit is the day's highest moon
    const at = (t: number) => moonAltitude(t, 52.23, 21.01);
    expect(at(e.moonUpper!)).toBeGreaterThan(at(e.moonUpper! - 3_600_000));
    expect(at(e.moonUpper!)).toBeGreaterThan(at(e.moonUpper! + 3_600_000));
    const p = solunar(e);
    expect(p.filter((x) => x.kind === 'major').length).toBeGreaterThan(0);
    expect(p.every((x) => x.end - x.start === (x.kind === 'major' ? 7_200_000 : 3_600_000))).toBe(true);
    expect(p.map((x) => x.start)).toEqual([...p.map((x) => x.start)].sort((a, b) => a - b));
    expect(solunar({ sunrise: null, sunset: null, moonrise: null, moonset: null, moonUpper: null, moonLower: null })).toEqual([]);
  });
});
