import { describe, expect, it } from 'vitest';
import type { Poi } from '../routing/service';
import { buildLocalIndex, fold, mergePlaces } from './localSearch';

const poi = (type: Poi['type'], name: string, lon = 21, lat = 52): Poi => ({ type, name, lon, lat });

describe('fold', () => {
  it('lowercases and drops accents and special letters', () => {
    expect(fold('Giżycko')).toBe('gizycko');
    expect(fold('Łódź')).toBe('lodz');
    expect(fold('Straße')).toBe('strasse');
    expect(fold('Øresund Æble Đakovo')).toBe('oresund aeble dakovo');
    expect(fold('Schleuse Kleinmachnow')).toBe('schleuse kleinmachnow');
  });
});

describe('local index', () => {
  const index = buildLocalIndex([
    poi('lock', 'Schleuse Liepe', 13.95, 52.85),
    poi('place', 'Liepe', 13.96, 52.85),
    poi('marina', 'Marina Lieper Bucht', 13.9, 52.8),
    poi('fuel', 'Oberliepe Tankstelle', 14, 53),
    poi('lock', '', 13, 52),
    poi('marina', 'Port Giżycko', 21.76, 54.03),
    poi('marina', 'Port Giżycko', 21.761, 54.031), // mapped twice
    poi('marina', 'Port Giżycko', 22.5, 54.5), // a namesake elsewhere
    poi('slipway', 'Liepe slip', 13.95, 52.85),
  ]);

  it('ranks names that start with the query first, then word starts, then the rest; towns and marinas first among equals', () => {
    expect(index.search('liepe').map((p) => p.label)).toEqual([
      'Liepe · town', 'Liepe slip · slipway', 'Marina Lieper Bucht · marina', 'Schleuse Liepe · lock', 'Oberliepe Tankstelle · fuel',
    ]);
    expect(index.search('liepe')[0].position).toEqual([13.96, 52.85]);
  });

  it('folds the query, needs two letters and limits the results', () => {
    expect(index.search('GIZYCKO').map((p) => p.label)).toEqual(['Port Giżycko · marina', 'Port Giżycko · marina']);
    expect(index.search(' l')).toEqual([]);
    expect(index.search('liepe', undefined, 2)).toHaveLength(2);
    expect(index.search('nothing like it')).toEqual([]);
  });

  it('puts nearer places first among equals', () => {
    expect(index.search('gizycko', [22.5, 54.5])[0].position).toEqual([22.5, 54.5]);
  });
});

describe('mergePlaces', () => {
  it('keeps local results and adds online ones that are other places', () => {
    const local = [{ label: 'Liepe · town', position: [13.96, 52.85] as [number, number] }];
    const online = [
      { label: 'Liepe, Deutschland', position: [13.961, 52.851] as [number, number] }, // the same town
      { label: 'Liepe, Usedom, Deutschland', position: [14.0, 54.0] as [number, number] },
      { label: 'Schleuse, Deutschland', position: [13.961, 52.851] as [number, number] }, // nearby, another name
    ];
    expect(mergePlaces(local, online).map((p) => p.label)).toEqual(['Liepe · town', 'Liepe, Usedom, Deutschland', 'Schleuse, Deutschland']);
    expect(mergePlaces(local, online, 2)).toHaveLength(2);
  });
});
