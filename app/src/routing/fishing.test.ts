import { describe, expect, it } from 'vitest';
import { fishingPL } from '../test/fishingFixture';
import { COUNTRY_RULES } from './rules';
import { closedOn, countryAt, FISHING, inRange, rangeText, seasonText, tripDays } from './fishing';

describe('fishing rules', () => {
  it('tell which seasons are closed on a day, in the waters asked, across the new year', () => {
    expect(inRange('2027-03-10', ['01-01', '04-30'])).toBe(true);
    expect(inRange('05-01', ['01-01', '04-30'])).toBe(false);
    expect(inRange('2026-12-15', ['11-01', '02-28'])).toBe(true);
    expect(inRange('2027-02-10', ['11-01', '02-28'])).toBe(true);
    expect(inRange('2027-06-10', ['11-01', '02-28'])).toBe(false);
    expect(closedOn(fishingPL, '2027-03-10').map((s) => s.species)).toEqual(['Pike', 'Cod']);
    expect(closedOn(fishingPL, '2027-03-10', ['sea']).map((s) => s.species)).toEqual(['Cod']);
    expect(closedOn(fishingPL, '2026-12-01', ['inland']).map((s) => s.species)).toEqual(['Zander']);
  });

  it('describe a season', () => {
    expect(rangeText(['01-01', '04-30'])).toBe('1 Jan–30 Apr');
    expect(seasonText(fishingPL.seasons[0])).toBe('Pike: closed 1 Jan–30 Apr; at least 50 cm; 2 per day');
    expect(seasonText(fishingPL.seasons[1])).toBe('Cod: closed 1 Jan–31 Dec; EU Baltic ban 2026–2027');
    expect(seasonText(fishingPL.seasons[3])).toBe('Perch: ');
  });

  it('find the country of a place from the nearest town, and the days of a trip', () => {
    const pois = [{ type: 'place' as const, name: 'A', lat: 54, lon: 21.7, cc: 'PL' }, { type: 'place' as const, name: 'B', lat: 54, lon: 21.9 },
      { type: 'marina' as const, name: 'M', lat: 54, lon: 21.71, cc: 'XX' }, { type: 'place' as const, name: 'C', lat: 54, lon: 22.5, cc: 'LT' }];
    expect(countryAt([21.75, 54], pois)).toBe('PL');
    expect(countryAt([22.45, 54], pois)).toBe('LT');
    expect(countryAt([30, 60], pois)).toBeNull();
    expect(tripDays('2026-12-30', '2027-01-02')).toEqual(['2026-12-30', '2026-12-31', '2027-01-01', '2027-01-02']);
    expect(tripDays('2027-01-01', '2028-06-01')).toHaveLength(366);
    expect(Object.values(FISHING).every((r) => r.sources.length && /^\d{4}-\d{2}-\d{2}$/.test(r.checked))).toBe(true);
    // every country with fishing rules has boating rules too (their names are taken from there)
    expect(Object.keys(FISHING).filter((cc) => !COUNTRY_RULES.some((r) => r.cc === cc))).toEqual([]);
    for (const r of Object.values(FISHING)) for (const s of r.seasons) for (const [a, b] of s.closed) expect(`${a}${b}`).toMatch(/^\d\d-\d\d\d\d-\d\d$/);
  });
});
