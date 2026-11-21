import type { FishingRules } from '../routing/fishing';

export const fishingPL: FishingRules = {
  inland: { licence: 'state card', permit: 'Wody Polskie permit (WIR app)', visitors: 'permit only', bans: 'within 50 m of weirs', boat: 'trolling allowed on lakes' },
  sea: { licence: 'none', visitors: null, reporting: 'RecFishing app', bans: null, boat: null },
  seasons: [
    { species: 'Pike', waters: 'inland', closed: [['01-01', '04-30']], minSizeCm: 50, bag: '2 per day', notes: null },
    { species: 'Cod', waters: 'sea', closed: [['01-01', '12-31']], minSizeCm: null, bag: null, notes: 'EU Baltic ban 2026–2027' },
    { species: 'Zander', waters: 'all', closed: [['11-01', '02-28']], minSizeCm: 45, bag: null, notes: null },
    { species: 'Perch', waters: 'inland', closed: [], minSizeCm: null, bag: null, notes: null },
  ],
  buy: 'https://wir.example', authority: { name: 'Wody Polskie', url: 'https://wody.example' }, sources: ['https://a.example/x'], checked: '2026-11-21',
};
