import { describe, expect, it } from 'vitest';
import { nearestSnap, snapHeights } from './sheetSnap';

describe('sheet snaps', () => {
  it('snaps a dragged height to the nearest of peek, half and full', () => {
    expect(snapHeights(1000)).toEqual({ peek: 96, half: 500, full: 880 });
    expect(nearestSnap(120, 1000)).toBe('peek');
    expect(nearestSnap(450, 1000)).toBe('half');
    expect(nearestSnap(990, 1000)).toBe('full');
  });
});
