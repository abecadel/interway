import { describe, expect, it, vi } from 'vitest';
import { empty, kanal, restricted } from '../test/waterwayFixture';

vi.mock('../data/waterways.json', () => ({ default: [] }));
const { aliasIndex, currentsByName, waterwaysOn, waterwayWarnings, WATERWAYS } = await import('./waterways');

describe('waterway sheets', () => {
  const index = aliasIndex([kanal, empty, restricted]);

  it('match legs by OSM name, in route order, each once; shared names give every sheet', () => {
    expect(waterwaysOn(['Low', 'unknown', 'der kanal', 'Kanal '], index).map((w) => w.id)).toEqual(['r', 'kanal']);
    expect(waterwaysOn(['Kanal'], index).map((w) => w.id)).toEqual(['kanal', 'r']);
    expect(waterwaysOn(['Kanal'])).toEqual([]); // the bundled data: empty in this test
    expect(WATERWAYS).toEqual([]);
  });

  it('give currents by name, the lower where sheets share a name', () => {
    expect(Object.fromEntries(currentsByName([kanal, empty, restricted]))).toEqual({ kanal: 0.4, 'der kanal': 1.2, low: 0.4 });
    expect(currentsByName().size).toBe(0);
  });

  it('warn about closures, restrictions, draft and air draft', () => {
    expect(waterwayWarnings([kanal, empty, restricted], 2, 4)).toEqual([
      'Kanal (A – B): draft 2 m exceeds the usual 1.5 m.',
      'Kanal (A – B): air draft 4 m vs lowest bridge 4 m.',
      'Bare canal: closed (see the notices).',
      'Low canal: navigation restricted (until 30 November).',
    ]);
    expect(waterwayWarnings([kanal], 1, 3)).toEqual([]);
    expect(waterwayWarnings([{ ...empty, notes: 'ice' }, { ...restricted, notes: null }], 1, 3))
      .toEqual(['Bare canal: closed (ice).', 'Low canal: navigation restricted (see the notices).']);
  });
});
