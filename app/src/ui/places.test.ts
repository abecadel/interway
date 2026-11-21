import { afterEach, describe, expect, it, vi } from 'vitest';
import { addRecent, isSaved, loadPlaces, RECENT_KEY, SAVED_KEY, shareLink, toggleSaved } from './places';

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
