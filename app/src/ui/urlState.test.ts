import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../routing/router';
import { parsePoint, parseUrlState, permalink, writeUrlState } from './urlState';

describe('URL state', () => {
  it('parses points, waypoints and the vessel', () => {
    const s = parseUrlState('?from=21.03,52.25&to=18.66, 54.35&via=19.1,52.6;bad;18.6,53.0&draft=1.5&air=4&len=12&speed=&beam=-1&avoidLocks=1');
    expect(s.from).toEqual([21.03, 52.25]);
    expect(s.to).toEqual([18.66, 54.35]);
    expect(s.via).toEqual([[19.1, 52.6], [18.6, 53.0]]);
    expect(s.vessel).toEqual({ draft: 1.5, airDraft: 4, length: 12, avoidLocks: true });
    expect(parseUrlState('?avoidLocks=0&avoidSea=true').vessel).toEqual({ avoidLocks: false, avoidSea: true });
    expect(parseUrlState('?coastal=1').vessel).toEqual({ coastal: true });
    expect(parseUrlState('?date=2027-05-01').vessel).toEqual({ departure: '2027-05-01' });
    expect(parseUrlState('?date=May').vessel).toEqual({});
    expect(writeUrlState('', { from: null, to: null, via: [] }, { ...defaultProfile, departure: '2027-05-01' })).toBe('date=2027-05-01');
    expect(writeUrlState('', { from: null, to: null, via: [] }, { ...defaultProfile, coastal: true })).toBe('coastal=1');
    expect(parseUrlState('')).toEqual({ from: null, to: null, via: [], vessel: {} });
  });

  it('rejects malformed points', () => {
    for (const v of ['1', '1,2,3', 'a,b', '200,10', '10,95', null, undefined]) expect(parsePoint(v)).toBeNull();
  });

  it('writes the route and non-default vessel values, keeping other parameters', () => {
    const q = writeUrlState('?lang=pl&via=0,0&draft=9', { from: [21.03, 52.25], to: [18.66, 54.35], via: [[19.1, 52.6]] },
      { ...defaultProfile, draft: 1.5, avoidLocks: true, avoidSea: true });
    expect(q).toBe('lang=pl&via=19.10000,52.60000&draft=1.5&from=21.03000,52.25000&to=18.66000,54.35000&avoidLocks=1&avoidSea=1');
    expect(writeUrlState(q, { from: null, to: null, via: [] }, defaultProfile)).toBe('lang=pl');
    expect(parseUrlState(`?${q}`).vessel).toEqual({ draft: 1.5, avoidLocks: true, avoidSea: true });
  });
});

describe('permalinks and links to places and sheets', () => {
  it('read a place, a waterway sheet and what a permalink was planned with', () => {
    const s = parseUrlState('?place=13.5,52.25&waterway=canal-du-midi&data=abc123&was=2795.4,245');
    expect(s.place).toEqual([13.5, 52.25]);
    expect(s.waterway).toBe('canal-du-midi');
    expect(s.planned).toEqual({ data: 'abc123', km: 2795.4, locks: 245 });
    expect(parseUrlState('?was=,x').planned).toEqual({ data: null, km: null, locks: null });
    const plain = parseUrlState('?place=nowhere&waterway=%20');
    expect(plain.place).toBeUndefined();
    expect(plain.waterway).toBeUndefined();
    expect(plain.planned).toBeUndefined();
  });

  it('write every setting, the data version and the route then; editing drops them', () => {
    const link = permalink('https://x/i/', { from: [1, 2], to: [3, 4], via: [] }, defaultProfile, 'abc', { km: 12.3, locks: 4 });
    expect(link).toBe('https://x/i/?from=1.00000,2.00000&to=3.00000,4.00000&draft=1&air=3&beam=0.5&len=9&speed=10&current=0.5&lockmin=20&data=abc&was=12.3,4');
    expect(permalink('b', { from: [1, 2], to: [3, 4], via: [] }, defaultProfile, null, { km: 1, locks: 0 })).not.toContain('data=');
    expect(writeUrlState('data=abc&was=1,2&place=1,2', { from: [1, 2], to: [3, 4], via: [] }, defaultProfile)).toBe('place=1,2&from=1.00000,2.00000&to=3.00000,4.00000');
  });
});
