import type { WaterwayInfo } from '../routing/waterways';

export const kanal: WaterwayInfo = {
  id: 'kanal', name: 'Kanal (A – B)', aliases: ['Kanal', 'Der Kanal'], countries: ['DE'], reach: 'A to B', navigable: 'seasonal',
  class: 'Vb', lengthKm: 100,
  depth: { usualM: 2.5, maxDraftM: 1.5, notes: 'less in summer' }, airDraftM: 4,
  current: { typicalMs: 1.2, notes: 'faster in spring' },
  locks: { count: 3, chamber: '190 × 12 m', hours: '6–22', notes: null },
  season: { best: 'May–September', closures: 'ice in January' },
  tides: { tidal: true, rangeM: 0.3, notes: 'to the first lock' },
  months: { closed: [7, 8, 9, 10], lowWater: [6], highWater: [2, 3], ice: [1], notes: 'summit pound short of water' },
  authority: { name: 'WSA', url: 'https://www.wsa.example' }, notices: 'https://www.elwis.de',
  notes: 'Sportbootführerschein needed.', sources: ['https://www.elwis.de/a', 'https://de.wikipedia.org/wiki/Kanal'], checked: '2026-11-21',
};

export const empty: WaterwayInfo = {
  id: 'empty', name: 'Bare canal', aliases: ['Bare'], countries: [], reach: '', navigable: 'closed', class: null, lengthKm: null,
  depth: { usualM: null, maxDraftM: null, notes: null }, airDraftM: null, current: { typicalMs: null, notes: null },
  locks: { count: null, chamber: null, hours: null, notes: null }, season: { best: null, closures: null },
  authority: { name: 'Nobody', url: null }, notices: null, notes: null, sources: ['not a url'], checked: '2026-11-21',
};

export const restricted: WaterwayInfo = { ...empty, id: 'r', name: 'Low canal', aliases: ['Low', 'Kanal'], navigable: 'restricted',
  current: { typicalMs: 0.4, notes: null }, notes: 'until 30 November' };
