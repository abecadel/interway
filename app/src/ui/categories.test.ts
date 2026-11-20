import { describe, expect, it } from 'vitest';
import type { Poi } from '../routing/service';
import { nearest } from './categories';

describe('nearest', () => {
  it('lists the closest places of one kind', () => {
    const pois: Poi[] = [
      { type: 'marina', name: 'far', lat: 54, lon: 20 },
      { type: 'marina', name: 'near', lat: 52.01, lon: 20 },
      { type: 'lock', name: 'lock', lat: 52, lon: 20 },
    ];
    expect(nearest(pois, 'marina', [20, 52]).map((x) => x.poi.name)).toEqual(['near', 'far']);
    expect(nearest(pois, 'marina', [20, 52], 1)).toHaveLength(1);
  });
});
