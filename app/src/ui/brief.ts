// A route brief: everything about a planned route in one document, as JSON for programs and AI agents and as
// Markdown for people (and for pasting into a chat).
import type { Itinerary, Stop } from '../routing/itinerary';
import { dateAfter, defaultProfile, type Route, type VesselProfile } from '../routing/router';
import type { PoiType } from '../routing/service';
import { fmtDuration, POI_LABEL, poiDetail } from './format';
import { portFacts } from './portFacts';
import { noticesFor } from './notices';
import { type CountryRules, routeCountries, ruleFacts, rulesFor } from '../routing/rules';
import { legPoints, monthsText, rulesText, seasonWarnings, tideText, type WaterwayInfo, waterwaysOn, waterwayWarnings } from '../routing/waterways';

export interface BriefStop {
  km: number;
  type: PoiType;
  name: string;
  detail?: string;
  /** km off the route line (services and towns) */
  offKm?: number;
  lat: number;
  lon: number;
  /** why this vessel may not fit (lock chamber, bridge clearance) */
  problem?: string;
}

export interface BriefStage {
  day: number;
  fromKm: number;
  toKm: number;
  km: number;
  hours: number;
  endsAt: string;
  /** the stage is an open-sea passage with no harbour on the planned line: it cannot be split into days */
  atSea?: boolean;
  /** the day's date, when a departure date is set */
  date?: string;
  /** what is known about the harbour the stage ends at (VHF, phone, services, ...) */
  harbour?: string;
}

/** The longest stretch without a stop of some kind (fuel, water, ...), counting from the start and to the end. */
export interface ServiceGap {
  count: number;
  longestKm: number;
  fromKm: number;
  toKm: number;
}

export interface RouteBrief {
  title: string;
  link: string;
  vessel: Pick<VesselProfile, 'draft' | 'airDraft' | 'beam' | 'length' | 'speedKmh' | 'currentMs' | 'lockPenaltyMin' | 'avoidLocks' | 'avoidSea' | 'coastal' | 'departure'> & {
    /** dimensions left at the planner's default: not entered for this boat */
    defaults: ('draft' | 'airDraft' | 'beam' | 'length')[];
  };
  totals: {
    km: number; nm: number; hours: number; days: number; locks: number; seaNm: number; unverifiedKm: number;
    /** hours split: moving at cruising speed in still water, waiting and working locks, and what the current adds (negative: saves) */
    movingHours: number; lockHours: number; currentHours: number;
    /** open sea with no charted depth (outside EMODnet's coverage), NM */
    seaNoDepthNm: number;
    /** km with the river current (downstream) and against it (upstream) */
    downstreamKm: number; upstreamKm: number;
    /** open sea charted shallower than the vessel's draft that the route crosses anyway, km */
    tooShallowKm: number;
    /** tightest draft allowed by charted sea depth (EMODnet, minus a margin), m; null when unknown */
    maxSeaDraftM: number | null;
  };
  legs: { name: string; fromKm: number; toKm: number; km: number }[];
  places: string[];
  stops: BriefStop[];
  stages: BriefStage[];
  hazards: string[];
  edit: { link: string; parameters: Record<string, string> };
  /** researched sheets of the waterways on the route, in route order */
  waterways: WaterwayInfo[];
  /** the boating rules of the countries on the route (licence, permits, speed limits, ...), with sources */
  rules: CountryRules[];
  /** what to arrange before going: licences, permits and tolls, taxes, entry, data to complete */
  checklist: string[];
  /** the tightest mapped limit of each kind along the route and whether the boat fits */
  limits: { kind: 'draft' | 'airDraft' | 'beam' | 'length'; limitM: number; name: string; km: number; fits: boolean }[];
  /** the countries in route order, from where the route first passes one of their towns */
  countries: { cc: string; name: string; fromKm: number }[];
  /** fuel, water and overnight harbours along the route: how many and the longest stretch without one */
  services: { fuel: ServiceGap; water: ServiceGap; harbour: ServiceGap };
}

const km = (m: number) => Math.round(m / 100) / 10;
const nm = (m: number) => Math.round(m / 185.2) / 10;
const LAYOVER: PoiType[] = ['marina', 'port'];

export const EDIT_PARAMETERS: Record<string, string> = {
  from: 'start as lon,lat (decimal degrees)',
  to: 'destination as lon,lat',
  via: 'waypoints in order, lon,lat;lon,lat',
  draft: 'draft, m',
  air: 'air draft (height above water), m',
  beam: 'beam, m',
  len: 'length, m',
  speed: 'cruising speed, km/h',
  current: 'assumed river current, m/s',
  lockmin: 'minutes per lock',
  avoidLocks: '1 to prefer routes with fewer locks',
  avoidSea: '1 to keep to inland waterways wherever an inland way exists',
  coastal: '1 for a small boat: keep near the coast, harbour to harbour, instead of crossing open sea',
  date: 'departure date YYYY-MM-DD: daily stages get dates, and waterways usually closed in the month they are reached are avoided',
};

function problem(s: Stop, v: VesselProfile): string | undefined {
  const p = s.poi;
  if (p.type === 'lock' && p.maxlength !== undefined && v.length > p.maxlength) return `vessel length ${v.length} m exceeds chamber ${p.maxlength} m`;
  if (p.type === 'lock' && p.maxwidth !== undefined && v.beam > p.maxwidth) return `beam ${v.beam} m exceeds chamber width ${p.maxwidth} m`;
  if (p.type === 'bridge' && p.clearance !== undefined && v.airDraft >= p.clearance) return `air draft ${v.airDraft} m vs clearance ${p.clearance} m`;
  return undefined;
}

/** [from, to] metres of the open-sea legs (named "Open sea" by the router) */
function seaStretches(route: Route): [number, number][] {
  const out: [number, number][] = [];
  let at = 0;
  for (const l of route.legs) {
    if (l.name === 'Open sea') out.push([at, at + l.distance]);
    at += l.distance;
  }
  return out;
}

function stages(route: Route, stops: Stop[], hoursPerDay: number): BriefStage[] {
  const speed = route.duration > 0 ? route.distance / route.duration : 0; // m/s, locks included
  const dayM = speed * hoursPerDay * 3600;
  const out: BriefStage[] = [];
  const sea = seaStretches(route);
  const harbour = (s: Stop) => LAYOVER.includes(s.poi.type);
  let from = 0;
  while (from < route.distance) {
    let to = dayM > 0 ? Math.min(from + dayM, route.distance) : route.distance;
    let endsAt = to === route.distance ? 'destination' : `km ${km(to)}`;
    let atSea = false;
    let end: Stop | undefined;
    // a day cannot end out at sea: stop at the last harbour before the passage, or make the passage one stage
    const passage = sea.find(([a, b]) => to > a && to < b);
    if (passage) {
      const before = stops.filter((s) => harbour(s) && s.at > from && s.at <= passage[0]).at(-1);
      const after = stops.find((s) => harbour(s) && s.at > to && s.at < passage[1]);
      if (before ?? after) {
        end = (before ?? after)!;
        to = end.at;
        endsAt = `${POI_LABEL[end.poi.type]}${end.poi.name ? ` ${end.poi.name}` : ''}`;
      } else {
        to = passage[1];
        atSea = true;
        endsAt = to === route.distance ? 'destination' : `km ${km(to)}, end of the sea passage`;
      }
    } else if (to < route.distance) {
      // end the day at the last marina or port in its final fifth, if there is one
      const stop = stops.filter((s) => LAYOVER.includes(s.poi.type) && s.at > from + 0.8 * dayM && s.at <= to).at(-1);
      if (stop) {
        end = stop;
        to = stop.at;
        endsAt = `${POI_LABEL[stop.poi.type]}${stop.poi.name ? ` ${stop.poi.name}` : ''}`;
      } else {
        const town = stops.find((s) => s.poi.type === 'place' && Math.abs(s.at - to) < 10_000);
        if (town) endsAt += ` (near ${town.poi.name})`;
      }
    }
    const facts = end ? portFacts(end.poi).map((f) => `${f.label}: ${f.value}`).join('; ') : '';
    out.push({ day: out.length + 1, fromKm: km(from), toKm: km(to), km: km(to - from), hours: Math.round((to - from) / speed / 360) / 10, endsAt,
      ...(atSea && { atSea }), ...(facts && { harbour: facts }) });
    from = to;
  }
  return out;
}

/** "52.2500°N 21.0300°E → …" reads better as "Warsaw → …": coordinate labels become the nearest town (≤ 10 km). */
function nameEnds(title: string, route: Route, stops: Stop[]): string {
  const town = (at: number) => stops.filter((s) => s.poi.type === 'place' && Math.abs(s.at - at) <= 10_000)
    .sort((a, b) => Math.abs(a.at - at) - Math.abs(b.at - at))[0]?.poi.name;
  const ends = title.split(' → ');
  if (ends.length !== 2) return title;
  return ends.map((e, i) => (/°[NS] /.test(e) && town(i ? route.distance : 0)) || e).join(' → ');
}

export function buildBrief({ route, itinerary, profile, title, link, hoursPerDay = 8, entered }: {
  route: Route; itinerary: Itinerary; profile: VesselProfile; title: string; link: string; hoursPerDay?: number;
  /** vessel fields the user (or agent) gave, even where equal to the default */
  entered?: ReadonlySet<string>;
}): RouteBrief {
  let at = 0;
  const legs = route.legs.map((l) => {
    const leg = { name: l.name || 'unnamed waterway', fromKm: km(at), toKm: km(at + l.distance), km: km(l.distance) };
    at += l.distance;
    return leg;
  });
  const stops: BriefStop[] = itinerary.stops.map((s) => ({
    km: km(s.at),
    type: s.poi.type,
    name: s.poi.name,
    ...(poiDetail(s.poi) && { detail: poiDetail(s.poi) }),
    ...(s.offset >= 100 && { offKm: km(s.offset) }),
    lat: s.poi.lat,
    lon: s.poi.lon,
    ...(problem(s, profile) && { problem: problem(s, profile) }),
  }));
  const hazards: string[] = [];
  if (route.sea > 0) hazards.push(`${nm(route.sea)} NM on open sea (legs named "Open sea"): check weather, tides, traffic separation schemes and official charts.`);
  if (route.shallowest) {
    const { draft, at } = route.shallowest;
    hazards.push(`Shallowest open-sea stretch at km ${km(at)}: charted depth allows about ${draft} m draft`
      + `${profile.draft > draft - 0.5 ? ` (yours is ${profile.draft} m)` : ''}. EMODnet bathymetry, ~0.5 km grid: not for navigation.`);
  }
  if (route.seaNoDepth > 0) {
    hazards.push(`${nm(route.seaNoDepth)} NM of open sea with depth unknown: the planner has no charted depth there (EMODnet covers European seas only). Use official charts.`);
  }
  if (route.tooShallow > 0) {
    hazards.push(`${km(route.tooShallow)} km of open sea is charted shallower than your ${profile.draft} m draft and has no deeper way`
      + ' in the planner\'s coarse sea network: there may be a dredged channel, or the passage may need a different route. Check official charts.');
  }
  if (route.noMotor > 500) {
    hazards.push(`${km(route.noMotor)} km on waters where OpenStreetMap says motorboats are not allowed (motorboat=no or boat=no)`
      + ' and there is no other way: check the local rules, or plan another route.');
  }
  if (route.unverified > 0) hazards.push(`${km(route.unverified)} km on unverified connections (short channels or manual links): confirm locally.`);
  if (route.start.offset > 200 || route.end.offset > 200) {
    hazards.push(`Start/end were moved to the nearest navigable water (${km(route.start.offset)} km / ${km(route.end.offset)} km away).`);
  }
  const waterways = waterwaysOn(legPoints(route));
  hazards.push(...waterwayWarnings(waterways, profile.draft, profile.airDraft), ...seasonWarnings(route, profile));
  // each stage is a day, but a non-stop sea passage takes as many calendar days as it lasts
  let days = 0;
  const legStages = stages(route, itinerary.stops, hoursPerDay).map((st) => {
    const date = profile.departure ? dateAfter(profile.departure, days * hoursPerDay * 3600) : null;
    days += st.atSea && st.hours > 24 ? Math.ceil(st.hours / 24) : 1;
    return date ? { ...st, date } : st;
  });
  for (const st of legStages.filter((x) => x.atSea && x.hours > hoursPerDay)) {
    hazards.push(`km ${st.fromKm}–${st.toKm}: ${nm(1000 * st.km)} NM of open sea with no harbour on the planned line, about ${Math.round(st.hours)} h`
      + ' non-stop. Plan a coastal route with ports of refuge, or a passage with crew and a weather window.');
  }
  for (const s of stops) if (s.problem) hazards.push(`km ${s.km} ${POI_LABEL[s.type]}${s.name ? ` ${s.name}` : ''}: ${s.problem}.`);
  const countries = routeCountries(itinerary.stops);
  const notices = noticesFor(countries);
  hazards.push(notices.length
    ? `Today's closures, water levels and lock hours are not live here: check the notices to skippers for this route before going: ${notices.map((n) => `${n.cc} ${n.name} (${n.url})`).join('; ')}.`
    : "Today's closures, water levels and lock hours are not live here: check notices to skippers (e.g. ELWIS, Vaarweginformatie, VNF) before going.");
  const gap = (types: PoiType[]): ServiceGap => {
    const ats = itinerary.stops.filter((s) => types.includes(s.poi.type)).map((s) => s.at);
    const points = [0, ...ats, route.distance];
    let best = 0;
    for (let i = 1; i < points.length; i++) if (points[i] - points[i - 1] > points[best + 1] - points[best]) best = i - 1;
    return { count: ats.length, longestKm: km(points[best + 1] - points[best]), fromKm: km(points[best]), toKm: km(points[best + 1]) };
  };
  const countryRules = rulesFor(countries);
  const inland = route.distance - route.sea > 1000, atSea = route.sea > 0;
  const checklist = [
    ...DIMENSIONS.filter((k) => profile[k] === defaultProfile[k] && !entered?.has(k)).map((k) => `Give the boat's real ${DIM_TEXT[k]}: ${profile[k]} m is the planner's default.`),
    ...(profile.departure ? [] : ['Give a departure date (date=YYYY-MM-DD): waterways are then checked for the month the boat reaches them.']),
    ...countryRules.flatMap((r) => {
      const i = inland ? r.inland : null, s = atSea ? r.sea : null;
      const parts = [i?.licence && `licence: ${i.licence}`, i?.permit && `permits: ${i.permit}`, s?.taxes && `taxes: ${s.taxes}`, s?.entry && `entry: ${s.entry}`].filter(Boolean);
      return parts.length ? [`${r.name}: ${parts.join('; ')}.`] : [];
    }),
    ...waterways.filter((w) => w.rules?.permit).map((w) => `${w.name}: ${w.rules!.permit}.`),
    ...notices.map((n) => `Read the notices to skippers before going: ${n.cc} ${n.name} (${n.url}).`),
  ];
  const fromKm = new Map<string, number>();
  for (const s of itinerary.stops) if (s.poi.type === 'place' && s.poi.cc && !fromKm.has(s.poi.cc)) fromKm.set(s.poi.cc, km(s.at));
  const hours = route.duration / 3600;
  const movingH = route.distance / (profile.speedKmh / 3.6) / 3600;
  const lockH = (route.locks * profile.lockPenaltyMin) / 60;
  return {
    title: nameEnds(title, route, itinerary.stops),
    link,
    vessel: { draft: profile.draft, airDraft: profile.airDraft, beam: profile.beam, length: profile.length, speedKmh: profile.speedKmh, currentMs: profile.currentMs, lockPenaltyMin: profile.lockPenaltyMin, avoidLocks: profile.avoidLocks, avoidSea: profile.avoidSea, coastal: profile.coastal, departure: profile.departure,
      defaults: DIMENSIONS.filter((k) => profile[k] === defaultProfile[k] && !entered?.has(k)) },
    totals: {
      km: km(route.distance), nm: nm(route.distance), hours: Math.round(hours * 10) / 10,
      movingHours: Math.round(movingH * 10) / 10, lockHours: Math.round(lockH * 10) / 10, currentHours: Math.round((hours - movingH - lockH) * 10) / 10,
      days: legStages.length, locks: route.locks, seaNm: nm(route.sea), seaNoDepthNm: nm(route.seaNoDepth), unverifiedKm: km(route.unverified),
      tooShallowKm: km(route.tooShallow),
      downstreamKm: km(route.downstream), upstreamKm: km(route.upstream),
      maxSeaDraftM: route.shallowest?.draft ?? null,
    },
    legs,
    places: stops.filter((s) => s.type === 'place').map((s) => s.name),
    stops,
    stages: legStages,
    hazards,
    edit: { link, parameters: EDIT_PARAMETERS },
    waterways,
    rules: countryRules,
    checklist,
    limits: tightest(route, profile),
    countries: countries.map((cc) => ({ cc, name: countryRules.find((r) => r.cc === cc)?.name ?? cc, fromKm: fromKm.get(cc)! })),
    services: { fuel: gap(['fuel']), water: gap(['water']), harbour: gap(LAYOVER) },
  };
}

/** The tightest limit of each kind on the route: mapped structures (OSM) and the waterway sheets' lowest bridge and
 *  usual draft, whichever is lower, in route order. */
function tightest(route: Route, profile: VesselProfile): RouteBrief['limits'] {
  const best = new Map<RouteBrief['limits'][number]['kind'], { limit: number; name: string; at: number }>();
  const offer = (kind: RouteBrief['limits'][number]['kind'], limit: number, name: string, at: number) => {
    if ((best.get(kind)?.limit ?? Infinity) > limit) best.set(kind, { limit, name, at });
  };
  for (const l of route.limits) offer(l.kind, l.limit, l.name, l.at);
  let at = 0;
  for (const leg of legPoints(route)) {
    for (const w of waterwaysOn([leg])) {
      if (w.airDraftM !== null) offer('airDraft', w.airDraftM, `${w.name} (waterway sheet)`, at);
      if (w.depth.maxDraftM !== null) offer('draft', w.depth.maxDraftM, `${w.name} (waterway sheet)`, at);
    }
    at += leg.distance!; // legPoints gives every leg its length
  }
  return [...best.entries()].sort((x, y) => x[1].at - y[1].at)
    .map(([kind, l]) => ({ kind, limitM: l.limit, name: l.name, km: km(l.at), fits: Math.fround(profile[kind]) <= Math.fround(l.limit) }));
}

const cell = (s: string) => s.replace(/\|/g, '/');

function rulesMarkdown(rs: CountryRules[], where: { inland: boolean; sea: boolean }): string[] {
  if (!rs.length) return [];
  return ['## Rules by country', ...rs.flatMap((r) => [
    '',
    `### ${r.name}`,
    ...ruleFacts(r, where).map(([k, v]) => `- ${k}: ${v}`),
    `- Authority: ${r.authority.name}${r.authority.url ? ` (${r.authority.url})` : ''}`,
    `- Sources (checked ${r.checked}): ${r.sources.join(', ')}`,
  ]), ''];
}

function waterwaysMarkdown(ws: WaterwayInfo[]): string[] {
  if (!ws.length) return [];
  const line = (label: string, v: string | null | false) => (v ? [`- ${label}: ${v}`] : []);
  return ['## Waterways', ...ws.flatMap((w) => [
    '',
    `### ${w.name} (${w.navigable})`,
    w.reach,
    ...line('Gauge', w.class),
    ...line('Depth', [w.depth.usualM !== null && `usually ${w.depth.usualM} m`, w.depth.maxDraftM !== null && `draft up to ${w.depth.maxDraftM} m`, w.depth.notes].filter(Boolean).join('; ')),
    ...line('Lowest bridge', w.airDraftM !== null && `${w.airDraftM} m`),
    ...line('Current', [w.current.typicalMs !== null && `about ${w.current.typicalMs} m/s`, w.current.notes].filter(Boolean).join('; ')),
    ...line('Locks', [w.locks.count !== null && `${w.locks.count}`, w.locks.chamber, w.locks.hours, w.locks.notes].filter(Boolean).join('; ')),
    ...line('By month', monthsText(w)),
    ...line('Tides', tideText(w)),
    ...line('Rules', rulesText(w)),
    ...line('Best season', w.season.best),
    ...line('Closures', w.season.closures),
    ...line('Authority', `${w.authority.name}${w.authority.url ? ` (${w.authority.url})` : ''}`),
    ...line('Notices', w.notices),
    ...line('Notes', w.notes),
    `- Sources (checked ${w.checked}): ${w.sources.join(', ')}`,
  ]), ''];
}
const DIMENSIONS = ['draft', 'airDraft', 'beam', 'length'] as const;
const DIM_TEXT: Record<(typeof DIMENSIONS)[number], string> = { draft: 'draft', airDraft: 'air draft', beam: 'beam', length: 'length' };

const LIMIT_TEXT = { draft: 'Draft', airDraft: 'Air draft (headroom)', beam: 'Beam', length: 'Length' } as const;

function serviceLines(sv: RouteBrief['services']): string[] {
  const line = (what: string, g: ServiceGap) => `- ${what}: ${g.count} on the route; longest stretch without: ${g.longestKm} km (km ${g.fromKm}–${g.toKm})`;
  return [line('Fuel', sv.fuel), line('Water', sv.water), line('Marinas and ports', sv.harbour)];
}

export function briefMarkdown(b: RouteBrief): string {
  const t = b.totals, v = b.vessel;
  // a dimension left at the planner's default says so: it was not entered for this boat
  const dim = (k: (typeof DIMENSIONS)[number]) => `${v[k]} m${v.defaults.includes(k) ? ' (default, not entered)' : ''}`;
  const lines = [
    `# Route: ${b.title}`,
    '',
    `Open or edit: ${b.link}`,
    '',
    '## Summary',
    `- Distance: ${t.km} km (${t.nm} NM)`,
    `- Time underway: ${fmtDuration(t.hours * 3600)} at ${v.speedKmh} km/h in ${t.days} day(s) of up to 8 h: moving ${t.movingHours} h,`
      + ` locks ${t.lockHours} h (${v.lockPenaltyMin} min each), current ${t.currentHours >= 0 ? '+' : ''}${t.currentHours} h`,
    `- Locks: ${t.locks}`,
    ...(t.downstreamKm + t.upstreamKm > 0 ? [`- River current: ${v.currentMs} m/s, ${t.downstreamKm} km with it, ${t.upstreamKm} km against it`] : []),
    ...(t.seaNm > 0 ? [`- Open sea: ${t.seaNm} NM`] : []),
    ...(b.places.length ? [`- Towns on the way: ${b.places.join(', ')}`] : []),
    ...(b.countries.length ? [`- Countries: ${b.countries.map((c) => `${c.name} (from km ${c.fromKm})`).join(', ')}`] : []),
    ...serviceLines(b.services),
    '',
    ...(b.checklist.length ? ['## Before you go', ...b.checklist.map((c) => `- [ ] ${c}`), ''] : []),
    '## Vessel',
    `Draft ${dim('draft')}, air draft ${dim('airDraft')}, beam ${dim('beam')},`
      + ` length ${dim('length')}${v.avoidLocks ? ', avoiding locks where possible' : ''}${v.avoidSea ? ', avoiding open sea' : ''}${v.coastal ? ', keeping near the coast' : ''}.`,
    ...(b.limits.length ? [
      '', 'Tightest mapped limits on the route (where OpenStreetMap records them; many structures have none):',
      ...b.limits.map((l) => `- ${LIMIT_TEXT[l.kind]} ${l.limitM} m at km ${l.km} (${l.name}): ${l.fits ? 'fits' : `⚠ yours is ${v[l.kind]} m`}`),
    ] : []),
    ...(t.maxSeaDraftM !== null ? [`- Shallowest charted sea: about ${t.maxSeaDraftM} m draft`] : []),
    '',
    '## Hazards and checks',
    ...b.hazards.map((h) => `- ${h}`),
    '',
    ...waterwaysMarkdown(b.waterways),
    ...rulesMarkdown(b.rules, { inland: b.totals.km - b.totals.seaNm * 1.852 > 1, sea: b.totals.seaNm > 0 }),
    '## Legs',
    '| km | waterway | length |',
    '|---|---|---|',
    ...b.legs.map((l) => `| ${l.fromKm}–${l.toKm} | ${cell(l.name)} | ${l.km} km |`),
    '',
    '## Daily stages',
    '| day | km | distance | hours | end of day | harbour |',
    '|---|---|---|---|---|---|',
    ...b.stages.map((s) => `| ${s.date ? `${s.day} (${s.date})` : s.day} | ${s.fromKm}–${s.toKm} | ${s.km} km | ${s.hours} h | ${cell(s.endsAt)} | ${cell(s.harbour ?? '')} |`),
    '',
    '## Along the route',
    '| km | type | name | details |',
    '|---|---|---|---|',
    ...b.stops.map((s) => `| ${s.km} | ${POI_LABEL[s.type]} | ${cell(s.name)} | ${cell([s.detail, s.offKm !== undefined && `${s.offKm} km off`, s.problem && `⚠ ${s.problem}`].filter(Boolean).join('; '))} |`),
    '',
    '## Editing this route (for AI assistants)',
    'Change the parameters of the link above and open it; the planner recomputes everything:',
    ...Object.entries(b.edit.parameters).map(([k, d]) => `- \`${k}\`: ${d}`),
    '',
    'Data © OpenStreetMap contributors (ODbL), towns © GeoNames (CC BY 4.0), bathymetry © EMODnet (CC BY 4.0). Not for navigation.',
    '',
  ];
  return lines.join('\n');
}
