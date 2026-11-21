import { describe, expect, it } from 'vitest';
import { nearestSnap, rubberBand, snapHeights } from './sheetSnap';

describe('sheet snaps', () => {
  it('snaps a dragged height to the nearest of peek, half and full', () => {
    expect(snapHeights(1000)).toEqual({ peek: 72, half: 500, full: 880 });
    expect(nearestSnap(120, 1000)).toBe('peek');
    expect(nearestSnap(450, 1000)).toBe('half');
    expect(nearestSnap(990, 1000)).toBe('full');
  });

  it('carries a flick on to the next snap', () => {
    expect(nearestSnap(120, 1000, 2000)).toBe('half'); // up fast from just above peek
    expect(nearestSnap(560, 1000, -2000)).toBe('peek'); // down fast from half
  });

  it('gives less and less past the ends', () => {
    expect(rubberBand(300, 72, 880)).toBe(300);
    expect(rubberBand(0, 72, 880)).toBeCloseTo(72 - 40 * (1 - 1 / 1.6));
    expect(rubberBand(10_000, 72, 880)).toBeLessThan(920);
    expect(rubberBand(10_000, 72, 880)).toBeGreaterThan(915);
  });
});
