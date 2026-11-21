import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { bestPeriod, type DayEvents, type Period } from './astro';
import { DayBar } from './DayBar';

const H = 3_600_000;
const midnight = new Date(2026, 5, 1).getTime();
const none: DayEvents = { sunrise: null, sunset: null, moonrise: null, moonset: null, moonUpper: null, moonLower: null };
const periods: Period[] = [
  { kind: 'minor', start: midnight + 3 * H, end: midnight + 4 * H },
  { kind: 'major', start: midnight + 6 * H, end: midnight + 8 * H },
  { kind: 'major', start: midnight + 18 * H, end: midnight + 20 * H },
];

describe('DayBar', () => {
  it('picks the next major period, else the first', () => {
    expect(bestPeriod(periods, midnight)).toBe(periods[1]);
    expect(bestPeriod(periods, midnight + 7 * H)).toBe(periods[1]); // under way
    expect(bestPeriod(periods, midnight + 9 * H)).toBe(periods[2]);
    expect(bestPeriod(periods, midnight + 21 * H)).toBe(periods[1]);
    expect(bestPeriod([periods[0]], midnight)).toBeNull();
  });

  it('shades daylight, draws the periods and now', () => {
    const { container } = render(<DayBar midnight={midnight} day={{ ...none, sunrise: midnight + 6 * H, sunset: midnight + 18 * H }} periods={periods} now={midnight + 12 * H} daylight />);
    expect(screen.getByText('Best:')).toBeTruthy();
    expect(container.querySelector('.day')!.getAttribute('x')).toBe('60');
    expect(container.querySelector('.day')!.getAttribute('width')).toBe('120');
    expect(container.querySelectorAll('.major')).toHaveLength(2);
    expect(container.querySelector('.now')!.getAttribute('x')).toBe('119');
  });

  it('copes with a day that only rises or sets, midnight sun, polar night, and no periods', () => {
    const shade = (day: DayEvents, daylight: boolean, now = midnight - H) => {
      const { container, unmount } = render(<DayBar midnight={midnight} day={day} periods={[]} now={now} daylight={daylight} />);
      const d = container.querySelector('.day');
      const out = d && [d.getAttribute('x'), d.getAttribute('width')];
      expect(container.querySelector('.now')).toBeNull();
      expect(screen.queryByText('Best:')).toBeNull();
      unmount();
      return out;
    };
    expect(shade({ ...none, sunset: midnight + 2 * H }, false)).toEqual(['0', '20']); // light until it sets
    expect(shade({ ...none, sunrise: midnight + 22 * H }, false)).toEqual(['220', '20']); // light from sunrise
    expect(shade(none, true)).toEqual(['0', '240']);
    expect(shade(none, false, midnight + 30 * H)).toBeNull();
  });
});
