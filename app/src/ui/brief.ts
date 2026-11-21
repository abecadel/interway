// A route brief: everything about a planned route in one document, as JSON for programs and AI agents and as
// Markdown for people (and for pasting into a chat).
import type { Itinerary, Stop } from '../routing/itinerary';
import { dateAfter, defaultProfile, type Route, type VesselProfile } from '../routing/router';
import type { PoiType } from '../routing/service';
import { fmtDuration, POI_LABEL, poiDetail } from './format';
import { noticesFor } from './notices';
import { legPoints, monthsText, seasonWarnings, tideText, type WaterwayInfo, waterwaysOn, waterwayWarnings } from '../routing/waterways';

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
    // a day cannot end out at sea: stop at the last harbour before the passage, or make the passage one stage
    const passage = sea.find(([a, b]) => to > a && to < b);
    if (passage) {
      const before = stops.filter((s) => harbour(s) && s.at > from && s.at <= passage[0]).at(-1);
      const after = stops.find((s) => harbour(s) && s.at > to && s.at < passage[1]);
      if (before) {
        to = before.at;
        endsAt = `${POI_LABEL[before.poi.type]}${before.poi.name ? ` ${before.poi.name}` : ''}`;
      } else if (after) {
        to = after.at;
        endsAt = `${POI_LABEL[after.poi.type]}${after.poi.name ? ` ${after.poi.name}` : ''}`;
      } else {
        to = passage[1];
        atSea = true;
        endsAt = to === route.distance ? 'destination' : `km ${km(to)}, end of the sea passage`;
      }
    } else if (to < route.distance) {
      // end the day at the last marina or port in its final fifth, if there is one
      const stop = stops.filter((s) => LAYOVER.includes(s.poi.type) && s.at > from + 0.8 * dayM && s.at <= to).at(-1);
      if (stop) {
        to = stop.at;
        endsAt = `${POI_LABEL[stop.poi.type]}${stop.poi.name ? ` ${stop.poi.name}` : ''}`;
      } else {
        const town = stops.find((s) => s.poi.type === 'place' && Math.abs(s.at - to) < 10_000);
        if (town) endsAt += ` (near ${town.poi.name})`;
      }
    }
    out.push({ day: out.length + 1, fromKm: km(from), toKm: km(to), km: km(to - from), hours: Math.round((to - from) / speed / 360) / 10, endsAt,
      ...(atSea && { atSea }) });
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
  const notices = noticesFor(itinerary.stops.flatMap((s) => (s.poi.type === 'place' && s.poi.cc ? [s.poi.cc] : [])));
  hazards.push(notices.length
    ? `Today's closures, water levels and lock hours are not live here: check the notices to skippers for this route before going: ${notices.map((n) => `${n.cc} ${n.name} (${n.url})`).join('; ')}.`
    : "Today's closures, water levels and lock hours are not live here: check notices to skippers (e.g. ELWIS, Vaarweginformatie, VNF) before going.");
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
  };
}

const cell = (s: string) => s.replace(/\|/g, '/');

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
    ...line('Best season', w.season.best),
    ...line('Closures', w.season.closures),
    ...line('Authority', `${w.authority.name}${w.authority.url ? ` (${w.authority.url})` : ''}`),
    ...line('Notices', w.notices),
    ...line('Notes', w.notes),
    `- Sources (checked ${w.checked}): ${w.sources.join(', ')}`,
  ]), ''];
}
const DIMENSIONS = ['draft', 'airDraft', 'beam', 'length'] as const;

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
    '',
    '## Vessel',
    `Draft ${dim('draft')}, air draft ${dim('airDraft')}, beam ${dim('beam')},`
      + ` length ${dim('length')}${v.avoidLocks ? ', avoiding locks where possible' : ''}${v.avoidSea ? ', avoiding open sea' : ''}${v.coastal ? ', keeping near the coast' : ''}.`,
    '',
    '## Hazards and checks',
    ...b.hazards.map((h) => `- ${h}`),
    '',
    ...waterwaysMarkdown(b.waterways),
    '## Legs',
    '| km | waterway | length |',
    '|---|---|---|',
    ...b.legs.map((l) => `| ${l.fromKm}–${l.toKm} | ${cell(l.name)} | ${l.km} km |`),
    '',
    '## Daily stages',
    '| day | km | distance | hours | end of day |',
    '|---|---|---|---|---|',
    ...b.stages.map((s) => `| ${s.date ? `${s.day} (${s.date})` : s.day} | ${s.fromKm}–${s.toKm} | ${s.km} km | ${s.hours} h | ${cell(s.endsAt)} |`),
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
