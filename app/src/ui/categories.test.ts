import { describe, expect, it } from 'vitest';
import type { Poi } from '../routing/service';
import { nearbyPois, nearest } from './categories';

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

describe('nearbyPois', () => {
  it('lists the services and structures within 5 km, not towns and not the place itself', () => {
    const pois: Poi[] = [
      { type: 'lock', name: 'here', lat: 54, lon: 21 },
      { type: 'fuel', name: 'fuel', lat: 54.01, lon: 21 },
      { type: 'place', name: 'town', lat: 54.005, lon: 21 },
      { type: 'marina', name: 'marina', lat: 54.002, lon: 21 },
      { type: 'slipway', name: 'far', lat: 54.06, lon: 21 },
      { type: 'water', name: 'east', lat: 54, lon: 21.2 },
    ];
    expect(nearbyPois(pois, [21, 54]).map((x) => x.poi.name)).toEqual(['marina', 'fuel']);
    expect(nearbyPois(pois, [21, 54], 1)).toHaveLength(1);
  });
});
