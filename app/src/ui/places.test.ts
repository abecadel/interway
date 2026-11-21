import { afterEach, describe, expect, it, vi } from 'vitest';
import { addRecent, approximate, isSaved, loadPlaces, RECENT_KEY, SAVED_KEY, shareLink, toggleSaved, townLabel } from './places';

const a = { label: 'A', position: [1, 2] as [number, number] };
const b = { label: 'B', position: [3, 4] as [number, number] };

describe('recent and saved places', () => {
  afterEach(() => { localStorage.clear(); vi.restoreAllMocks(); });

  it('keeps the newest recent place first, once, at most eight', () => {
    let list = addRecent([], a);
    list = addRecent(list, b);
    list = addRecent(list, a);
    expect(list).toEqual([a, b]);
    expect(loadPlaces(RECENT_KEY)).toEqual([a, b]);
    for (let i = 0; i < 10; i++) list = addRecent(list, { label: `P${i}`, position: [i, i] });
    expect(list).toHaveLength(8);
  });

  it('saves and unsaves', () => {
    let list = toggleSaved([], a);
    expect(isSaved(list, a)).toBe(true);
    expect(isSaved(list, b)).toBe(false);
    expect(loadPlaces(SAVED_KEY)).toEqual([a]);
    list = toggleSaved(list, a);
    expect(list).toEqual([]);
  });

  it('survives bad or blocked storage', () => {
    localStorage.setItem(SAVED_KEY, '{oops');
    expect(loadPlaces(SAVED_KEY)).toEqual([]);
    localStorage.setItem(SAVED_KEY, '{"label":"x"}');
    expect(loadPlaces(SAVED_KEY)).toEqual([]);
    localStorage.setItem(SAVED_KEY, JSON.stringify([a, { label: 1 }, null]));
    expect(loadPlaces(SAVED_KEY)).toEqual([a]);
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    expect(addRecent([], a)).toEqual([a]);
  });

  it('links to a place, opening its card', () => {
    expect(shareLink([13.5, 52.25], { origin: 'https://x', pathname: '/interway/' } as Location)).toBe('https://x/interway/?place=13.50000,52.25000');
    expect(shareLink([1, 2])).toContain('?place=1.00000,2.00000');
  });
});

describe('approximate places', () => {
  it('round to 0.01°, about 1 km', () => {
    expect(approximate([21.76441, 54.03811])).toEqual([21.76, 54.04]);
  });
});

describe('town names for bare points', () => {
  const towns = [{ name: 'Giżycko', lat: 54.04, lon: 21.76 }, { name: 'Wilkasy', lat: 54.01, lon: 21.73 }, { name: 'Far', lat: 60, lon: 21.76 }];
  it('names a point after the nearest town within 3 km', () => {
    expect(townLabel(towns, [21.762, 54.039])).toBe('Giżycko');
    expect(townLabel(towns, [21.76, 54.058])).toBe('near Giżycko'); // 2 km north
    expect(townLabel(towns, [21.731, 54.012])).toBe('Wilkasy');
    expect(townLabel(towns, [21.76, 54.1])).toBeNull(); // 6.7 km
    expect(townLabel([], [21.76, 54.04])).toBeNull();
    expect(townLabel(towns, [21.752, 54.033])).toBe('Giżycko'); // Wilkasy is within 3 km too, but further
  });
});
