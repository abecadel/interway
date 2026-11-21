// The rules for pleasure boats in each country a route passes: licence, permits and tolls, speed limits, alcohol,
// equipment, waters closed to motorboats, and at sea the speed zones, anchoring bans, entry and taxes. Researched
// from official sources (data/rules.json), each country with its sources and the date it was checked.
import rules from '../data/rules.json';

export interface InlandRules {
  regulation: string | null;
  licence: string | null;
  licenceThresholdKw: number | null;
  foreignLicence: string | null;
  permit: string | null;
  permitCost: string | null;
  registration: string | null;
  vhf: string | null;
  speedLimits: string | null;
  alcohol: string | null;
  equipment: string | null;
  motorboatBans: string | null;
  other: string[];
}

export interface SeaRules {
  regulation: string | null;
  licence: string | null;
  coastalSpeed: string | null;
  anchoring: string | null;
  entry: string | null;
  taxes: string | null;
  other: string[];
}

export interface CountryRules {
  cc: string;
  name: string;
  inland: InlandRules | null;
  sea: SeaRules | null;
  authority: { name: string; url: string | null };
  sources: string[];
  checked: string;
}

export const COUNTRY_RULES = rules as CountryRules[];

/** The countries a route passes, in order, from the towns along it (they carry their country code). */
export function routeCountries(stops: { poi: { type: string; cc?: string } }[]): string[] {
  return [...new Set(stops.flatMap((s) => (s.poi.type === 'place' && s.poi.cc ? [s.poi.cc] : [])))];
}

/** The rules of the countries given, in that order, each once. */
export function rulesFor(countries: string[], all: CountryRules[] = COUNTRY_RULES): CountryRules[] {
  const byCc = new Map(all.map((r) => [r.cc, r]));
  return [...new Set(countries)].flatMap((cc) => byCc.get(cc) ?? []);
}

/** What applies on this route in a country: inland rules where the route goes inland, sea rules where it is at sea. */
export function ruleFacts(r: CountryRules, where: { inland: boolean; sea: boolean }): [string, string][] {
  const i = where.inland ? r.inland : null, s = where.sea ? r.sea : null;
  const facts: [string, string | null | undefined][] = [
    ['Licence', i?.licence ?? s?.licence],
    ['Sea licence', i && s && s.licence !== i.licence ? s.licence : null],
    ['Foreign licences', i?.foreignLicence],
    ['Permits and tolls', [i?.permit, i?.permitCost].filter(Boolean).join('; ') || null],
    ['Registration', i?.registration],
    ['Radio', i?.vhf],
    ['Speed limits', i?.speedLimits],
    ['Coastal speed', s?.coastalSpeed],
    ['Closed to motorboats', i?.motorboatBans],
    ['Alcohol', i?.alcohol],
    ['Equipment', i?.equipment],
    ['Anchoring', s?.anchoring],
    ['Entry and customs', s?.entry],
    ['Taxes', s?.taxes],
    ['Also', [...(i?.other ?? []), ...(s?.other ?? [])].join('; ') || null],
    ['Regulation', [i?.regulation, s?.regulation].filter(Boolean).join('; ') || null],
  ];
  return facts.filter((f): f is [string, string] => !!f[1]);
}
