import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../routing/router';
import { makeSnapshot, readSnapshot, snapshotName } from './snapshot';

const route = { coordinates: [[1, 2], [3, 4]], distance: 1000, locks: 0 } as never;
const brief = { title: 'Wrocław → Monaco' } as never;

describe('route snapshots', () => {
  it('save and read back the exact route', () => {
    const s = makeSnapshot({ data: 'abc', link: 'l', from: [1, 2], to: [3, 4], via: [[2, 3]], profile: defaultProfile, entered: ['draft'], route, brief },
      new Date('2027-05-01T10:00:00Z'));
    expect(s).toMatchObject({ interway: 'route-snapshot', version: 1, savedAt: '2027-05-01T10:00:00.000Z', data: 'abc' });
    expect(readSnapshot(JSON.stringify(s))).toEqual(s);
    expect(snapshotName(s)).toBe('interway-wroclaw-monaco-2027-05-01.json');
    expect(snapshotName({ ...s, brief: { title: '→' } as never })).toBe('interway-route-2027-05-01.json');
    expect(makeSnapshot({ ...s }).savedAt).toMatch(/^\d{4}-/);
  });

  it('say why a file is not a snapshot', () => {
    expect(() => readSnapshot('{')).toThrow('not JSON');
    expect(() => readSnapshot('{"a":1}')).toThrow('Not a route snapshot from Interway');
    expect(() => readSnapshot('{"interway":"route-snapshot","version":2}')).toThrow('version 2 is not supported');
    const ok = { interway: 'route-snapshot', version: 1, from: [1, 2], to: [3, 4], via: [], route: { coordinates: [] }, profile: {}, brief: {} };
    expect(readSnapshot(JSON.stringify(ok)).from).toEqual([1, 2]);
    for (const bad of [{ from: [1] }, { to: 'x' }, { via: [[1, 'a']] }, { via: 'x' }, { route: null }, { route: {} }, { profile: null }, { brief: null }]) {
      expect(() => readSnapshot(JSON.stringify({ ...ok, ...bad }))).toThrow('incomplete');
    }
    expect(() => readSnapshot('null')).toThrow('Not a route snapshot from Interway');
  });
});
