// Everything a route asks the skipper to check, as notices ranked by how much they matter: one card shows the
// most serious and the rest fold under it, instead of a wall of separate warnings.
import { dateAfter, type Route, type VesselProfile } from '../routing/router';
import { type IssueKind, seasonWarnings, type WaterwayInfo, waterwayIssues } from '../routing/waterways';
import { fmtKm, fmtNm } from './format';

export type Level = 'error' | 'warn' | 'info';

export interface Notice {
  level: Level;
  title: string;
  detail?: string;
  /** one line each, shown when the notice is opened */
  items?: string[];
}

const RANK: Record<Level, number> = { error: 0, warn: 1, info: 2 };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** how each kind of waterway issue is summed up: its level and a title for one or several waterways */
const ISSUES: Record<IssueKind, { level: Level; title: (names: string[], p: VesselProfile) => string }> = {
  closed: { level: 'error', title: (n) => (n.length === 1 ? `${n[0]} is closed` : `${n.length} waterways closed`) },
  draft: { level: 'error', title: (n, p) => `Too shallow for ${p.draft} m draft on ${n.length === 1 ? n[0] : plural(n.length, 'waterway')}` },
  air: { level: 'error', title: (n, p) => `Bridges too low for ${p.airDraft} m air draft on ${n.length === 1 ? n[0] : plural(n.length, 'waterway')}` },
  banned: { level: 'warn', title: (n) => `Motorboats not allowed on ${n.length === 1 ? n[0] : plural(n.length, 'waterway')}` },
  restricted: { level: 'warn', title: (n) => `Navigation restricted on ${n.length === 1 ? n[0] : plural(n.length, 'waterway')}` },
  bridge: { level: 'warn', title: (n) => `Little room under the bridges of ${n.length === 1 ? n[0] : plural(n.length, 'waterway')}` },
};

export function routeNotices(route: Route, profile: VesselProfile, waterways: WaterwayInfo[]): Notice[] {
  const out: Notice[] = [];
  const issues = waterwayIssues(waterways, profile.draft, profile.airDraft);
  for (const kind of Object.keys(ISSUES) as IssueKind[]) {
    const of = issues.filter((i) => i.kind === kind);
    if (!of.length) continue;
    const names = of.map((i) => i.waterway.name);
    // with a departure date, a closure as of the sheet's date is for checking, not final: the season notes say
    // whether the waterway is usually open when the boat gets there
    if (kind === 'closed' && dateAfter(profile.departure, 0) !== null) {
      out.push({ level: 'warn', title: `${names.length === 1 ? `${names[0]} is` : `${names.length} waterways are`} closed now: check before you go`,
        detail: names.length === 1 ? of[0].text : names.join(', '), items: of.length > 1 ? of.map((i) => i.text) : undefined });
      continue;
    }
    out.push({ level: ISSUES[kind].level, title: ISSUES[kind].title(names, profile), detail: of.length === 1 ? of[0].text : names.join(', '), items: of.length > 1 ? of.map((i) => i.text) : undefined });
  }
  const season = seasonWarnings(route, profile);
  if (season.length) {
    // the last line may be the advice on when to go instead
    const advice = /^(All the waterways|Some waterway)/.test(season[season.length - 1]) ? season[season.length - 1] : undefined;
    const lines = advice ? season.slice(0, -1) : season;
    out.push({ level: 'warn', title: `${plural(lines.length, 'seasonal note')} for your dates`, detail: advice, items: lines });
  }
  if (route.noMotor > 500) {
    out.push({ level: 'warn', title: `${fmtKm(route.noMotor)} where motorboats may not be allowed`,
      detail: 'OpenStreetMap says motorboats are not allowed there, and there is no other way. Check the local rules.' });
  }
  if (route.tooShallow > 0) {
    out.push({ level: 'warn', title: `${(route.tooShallow / 1000).toFixed(0)} km charted shallower than your draft`, detail: 'Check the charts for a channel.' });
  }
  if (route.sea > 0) {
    out.push({
      level: 'info', title: `${fmtNm(route.sea)} on open sea`,
      detail: [profile.avoidSea && 'No inland way avoids it.', 'Check the weather, tides, traffic schemes and official charts before going.',
        route.shallowest && `The shallowest stretch allows about ${route.shallowest.draft} m draft (km ${(route.shallowest.at / 1000).toFixed(0)}).`,
        route.seaNoDepth > 0 && `Depth unknown for ${fmtNm(route.seaNoDepth)}: no charted depth in the planner there.`].filter(Boolean).join(' '),
    });
  }
  if (route.unverified > 0) {
    out.push({ level: 'info', title: `${fmtKm(route.unverified)} on unverified connections`, detail: 'Short channels or manual links: check locally before going.' });
  }
  if (route.start.offset > 200 || route.end.offset > 200) {
    const far = [route.start.offset > 200 && `the start ${fmtKm(route.start.offset)} away`, route.end.offset > 200 && `the end ${fmtKm(route.end.offset)} away`];
    out.push({ level: 'info', title: 'Start or end moved to navigable water', detail: `Nearest navigable water: ${far.filter(Boolean).join(', ')}.` });
  }
  return out.sort((a, b) => RANK[a.level] - RANK[b.level]);
}
