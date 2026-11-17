// A route brief: everything about a planned route in one document, as JSON for programs and AI agents and as
// Markdown for people (and for pasting into a chat).
import type { Itinerary, Stop } from '../routing/itinerary';
import type { Route, VesselProfile } from '../routing/router';
import type { PoiType } from '../routing/service';
import { fmtDuration, POI_LABEL, poiDetail } from './format';

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
}

export interface RouteBrief {
  title: string;
  link: string;
  vessel: Pick<VesselProfile, 'draft' | 'airDraft' | 'beam' | 'length' | 'speedKmh' | 'avoidLocks'>;
  totals: { km: number; nm: number; hours: number; days: number; locks: number; seaNm: number; unverifiedKm: number };
  legs: { name: string; fromKm: number; toKm: number; km: number }[];
  places: string[];
  stops: BriefStop[];
  stages: BriefStage[];
  hazards: string[];
  edit: { link: string; parameters: Record<string, string> };
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
};

function problem(s: Stop, v: VesselProfile): string | undefined {
  const p = s.poi;
  if (p.type === 'lock' && p.maxlength !== undefined && v.length > p.maxlength) return `vessel length ${v.length} m exceeds chamber ${p.maxlength} m`;
  if (p.type === 'lock' && p.maxwidth !== undefined && v.beam > p.maxwidth) return `beam ${v.beam} m exceeds chamber width ${p.maxwidth} m`;
  if (p.type === 'bridge' && p.clearance !== undefined && v.airDraft >= p.clearance) return `air draft ${v.airDraft} m vs clearance ${p.clearance} m`;
  return undefined;
}

function stages(route: Route, stops: Stop[], hoursPerDay: number): BriefStage[] {
  const speed = route.duration > 0 ? route.distance / route.duration : 0; // m/s, locks included
  const dayM = speed * hoursPerDay * 3600;
  const out: BriefStage[] = [];
  let from = 0;
  while (from < route.distance) {
    let to = dayM > 0 ? Math.min(from + dayM, route.distance) : route.distance;
    let endsAt = to === route.distance ? 'destination' : `km ${km(to)}`;
    if (to < route.distance) {
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
    out.push({ day: out.length + 1, fromKm: km(from), toKm: km(to), km: km(to - from), hours: Math.round((to - from) / speed / 360) / 10, endsAt });
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

export function buildBrief({ route, itinerary, profile, title, link, hoursPerDay = 8 }: {
  route: Route; itinerary: Itinerary; profile: VesselProfile; title: string; link: string; hoursPerDay?: number;
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
  if (route.unverified > 0) hazards.push(`${km(route.unverified)} km on unverified connections (short channels or manual links): confirm locally.`);
  if (route.start.offset > 200 || route.end.offset > 200) {
    hazards.push(`Start/end were moved to the nearest navigable water (${km(route.start.offset)} km / ${km(route.end.offset)} km away).`);
  }
  for (const s of stops) if (s.problem) hazards.push(`km ${s.km} ${POI_LABEL[s.type]}${s.name ? ` ${s.name}` : ''}: ${s.problem}.`);
  hazards.push('Depths, lock hours and closures are not included: check notices to skippers (e.g. ELWIS, Vaarweginformatie, VNF) before going.');
  const hours = route.duration / 3600;
  return {
    title: nameEnds(title, route, itinerary.stops),
    link,
    vessel: { draft: profile.draft, airDraft: profile.airDraft, beam: profile.beam, length: profile.length, speedKmh: profile.speedKmh, avoidLocks: profile.avoidLocks },
    totals: {
      km: km(route.distance), nm: nm(route.distance), hours: Math.round(hours * 10) / 10,
      days: Math.ceil(hours / hoursPerDay), locks: route.locks, seaNm: nm(route.sea), unverifiedKm: km(route.unverified),
    },
    legs,
    places: stops.filter((s) => s.type === 'place').map((s) => s.name),
    stops,
    stages: stages(route, itinerary.stops, hoursPerDay),
    hazards,
    edit: { link, parameters: EDIT_PARAMETERS },
  };
}

const cell = (s: string) => s.replace(/\|/g, '/');

export function briefMarkdown(b: RouteBrief): string {
  const t = b.totals, v = b.vessel;
  const lines = [
    `# Route: ${b.title}`,
    '',
    `Open or edit: ${b.link}`,
    '',
    '## Summary',
    `- Distance: ${t.km} km (${t.nm} NM)`,
    `- Time underway: ${fmtDuration(t.hours * 3600)} at ${v.speedKmh} km/h, about ${t.days} day(s) of 8 h`,
    `- Locks: ${t.locks}`,
    ...(t.seaNm > 0 ? [`- Open sea: ${t.seaNm} NM`] : []),
    ...(b.places.length ? [`- Towns on the way: ${b.places.join(', ')}`] : []),
    '',
    '## Vessel',
    `Draft ${v.draft} m, air draft ${v.airDraft} m, beam ${v.beam} m, length ${v.length} m${v.avoidLocks ? ', avoiding locks where possible' : ''}.`,
    '',
    '## Hazards and checks',
    ...b.hazards.map((h) => `- ${h}`),
    '',
    '## Legs',
    '| km | waterway | length |',
    '|---|---|---|',
    ...b.legs.map((l) => `| ${l.fromKm}–${l.toKm} | ${cell(l.name)} | ${l.km} km |`),
    '',
    '## Daily stages',
    '| day | km | distance | hours | end of day |',
    '|---|---|---|---|---|',
    ...b.stages.map((s) => `| ${s.day} | ${s.fromKm}–${s.toKm} | ${s.km} km | ${s.hours} h | ${cell(s.endsAt)} |`),
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
    'Data © OpenStreetMap contributors (ODbL), towns © GeoNames (CC BY 4.0). Not for navigation.',
    '',
  ];
  return lines.join('\n');
}
