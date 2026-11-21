import { describe, expect, it } from 'vitest';
import { defaultProfile } from '../routing/router';
import { parsePoint, parseUrlState, writeUrlState } from './urlState';

describe('URL state', () => {
  it('parses points, waypoints and the vessel', () => {
    const s = parseUrlState('?from=21.03,52.25&to=18.66, 54.35&via=19.1,52.6;bad;18.6,53.0&draft=1.5&air=4&len=12&speed=&beam=-1&avoidLocks=1');
    expect(s.from).toEqual([21.03, 52.25]);
    expect(s.to).toEqual([18.66, 54.35]);
    expect(s.via).toEqual([[19.1, 52.6], [18.6, 53.0]]);
    expect(s.vessel).toEqual({ draft: 1.5, airDraft: 4, length: 12, avoidLocks: true });
    expect(parseUrlState('?avoidLocks=0&avoidSea=true').vessel).toEqual({ avoidLocks: false, avoidSea: true });
    expect(parseUrlState('?coastal=1').vessel).toEqual({ coastal: true });
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
