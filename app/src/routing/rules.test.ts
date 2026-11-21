import { describe, expect, it } from 'vitest';
import { island, land } from '../test/rulesFixture';
import { COUNTRY_RULES, routeCountries, ruleFacts, rulesFor } from './rules';

describe('country rules', () => {
  it('give the countries of a route in order, from its towns', () => {
    const stops = [{ poi: { type: 'place', cc: 'XL' } }, { poi: { type: 'lock' } }, { poi: { type: 'place', cc: 'XI' } },
      { poi: { type: 'place', cc: 'XL' } }, { poi: { type: 'place' } }];
    expect(routeCountries(stops)).toEqual(['XL', 'XI']);
    expect(rulesFor(['XI', 'XL', 'XI', 'ZZ'], [land, island])).toEqual([island, land]);
    expect(COUNTRY_RULES.length).toBeGreaterThan(0);
    expect(COUNTRY_RULES.every((r) => r.sources.length && /^\d{4}-\d{2}-\d{2}$/.test(r.checked))).toBe(true);
  });

  it('list what applies where the route goes', () => {
    const inlandOnly = Object.fromEntries(ruleFacts(land, { inland: true, sea: false }));
    expect(inlandOnly).toMatchObject({ Licence: 'licence over 10 kW', 'Permits and tolls': 'vignette; €10', 'Closed to motorboats': 'Lake Quiet',
      Also: 'locks shut on Sundays', Regulation: 'Inland Code' });
    expect(inlandOnly['Coastal speed']).toBeUndefined();
    const both = Object.fromEntries(ruleFacts(land, { inland: true, sea: true }));
    expect(both).toMatchObject({ 'Sea licence': 'sea licence', 'Coastal speed': '5 kn within 300 m', Taxes: 'cruising tax', Regulation: 'Inland Code; Sea Code' });
    const sea = Object.fromEntries(ruleFacts(island, { inland: true, sea: true }));
    expect(sea).toEqual({ Licence: 'sea licence', 'Entry and customs': 'call customs 24 h ahead', Also: 'fly the Q flag' });
    expect(ruleFacts(island, { inland: true, sea: false })).toEqual([]);
    expect(Object.keys(Object.fromEntries(ruleFacts(land, { inland: false, sea: true })))).toEqual(
      ['Licence', 'Coastal speed', 'Anchoring', 'Entry and customs', 'Taxes', 'Regulation']);
  });
});
