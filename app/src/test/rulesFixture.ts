import type { CountryRules } from '../routing/rules';

export const land: CountryRules = {
  cc: 'XL', name: 'Landland',
  inland: {
    regulation: 'Inland Code', licence: 'licence over 10 kW', licenceThresholdKw: 10, foreignLicence: 'ICC accepted',
    permit: 'vignette', permitCost: '€10', registration: null, vhf: 'ATIS', speedLimits: '12 km/h on canals', alcohol: '0.5 ‰',
    equipment: 'lifejackets', motorboatBans: 'Lake Quiet', other: ['locks shut on Sundays'],
  },
  sea: { regulation: 'Sea Code', licence: 'sea licence', coastalSpeed: '5 kn within 300 m', anchoring: 'not on seagrass', entry: 'Schengen', taxes: 'cruising tax', other: [] },
  authority: { name: 'Waterways Authority', url: 'https://example.org' },
  sources: ['https://example.org/rules', 'https://example.org/sea'],
  checked: '2026-11-21',
};

export const island: CountryRules = {
  cc: 'XI', name: 'Island', inland: null,
  sea: { regulation: null, licence: 'sea licence', coastalSpeed: null, anchoring: null, entry: 'call customs 24 h ahead', taxes: null, other: ['fly the Q flag'] },
  authority: { name: 'Coastguard', url: null }, sources: ['https://example.org/island'], checked: '2026-11-21',
};
