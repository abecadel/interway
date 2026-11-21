import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_VIEW, loadView, saveView, VIEW_KEY } from './view';

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe('map view between visits', () => {
  it('starts at the default view, then where the map was left', () => {
    expect(loadView()).toEqual(DEFAULT_VIEW);
    saveView({ center: [-73.987654321, 40.712345678], zoom: 9.87654 });
    expect(loadView()).toEqual({ center: [-73.98765, 40.71235], zoom: 9.88 });
  });

  it('ignores stored values that are not a view', () => {
    for (const bad of ['not json', '{"center":[1],"zoom":3}', '{"center":[200,10],"zoom":3}', '{"center":[1,2],"zoom":30}',
      '{"center":[1,"x"],"zoom":3}', '{"center":[1,2]}', 'null']) {
      localStorage.setItem(VIEW_KEY, bad);
      expect(loadView()).toEqual(DEFAULT_VIEW);
    }
  });

  it('works without storage', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('denied'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('denied'); });
    expect(() => saveView({ center: [1, 2], zoom: 3 })).not.toThrow();
    expect(loadView()).toEqual(DEFAULT_VIEW);
  });
});
