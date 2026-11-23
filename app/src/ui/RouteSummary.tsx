import { type ReactNode, useState } from 'react';
import type { Itinerary } from '../routing/itinerary';
import { daysText } from './brief';
import type { Route, VesselProfile } from '../routing/router';
import { fmtDuration, fmtKm, fmtNm } from './format';
import type { PoiType } from '../routing/service';
import { Icon } from './icons';
import { ItineraryView } from './ItineraryView';
import { legPoints, waterwaysOn } from '../routing/waterways';
import { badgeUrl } from '../map/sprites';
import { Notices } from './Notices';
import { routeNotices } from './routeNotices';
import { optionName } from './routeOptions';
import { WaterwaysView } from './WaterwaysView';
import { RulesView } from './RulesView';
import { routeCountries, rulesFor } from '../routing/rules';

const STATS: [Exclude<PoiType, 'place'>, string, string][] = [
  ['lock', 'lock', 'locks'], ['fuel', 'fuel berth', 'fuel berths'], ['marina', 'marina', 'marinas'], ['slipway', 'slipway', 'slipways'],
];

/** Time first, then distance and locks, warnings, and Start / Steps; the rest (exports, offline map) under More. */
export function RouteSummary({ route, itinerary, profile, back, onStart, onStepsOpen, onFocus, more, options = [], chosen = 0, onChoose }: {
  route: Route;
  itinerary: Itinerary;
  profile: VesselProfile;
  /** time of the way back, when the current makes it differ */
  back: number | null;
  onStart: () => void;
  /** the steps opened: a phone sheet grows to show them */
  onStepsOpen: () => void;
  onFocus: (lon: number, lat: number) => void;
  more: ReactNode;
  /** the route and its alternatives, the best first; with more than one they are offered as choices */
  options?: Route[];
  chosen?: number;
  onChoose?: (i: number) => void;
}) {
  const [steps, setSteps] = useState(false);
  const waterways = waterwaysOn(legPoints(route));
  const rules = rulesFor(routeCountries(itinerary.stops));
  const notices = routeNotices(route, profile, waterways);
  const stats = STATS.map(([kind, one, many]) => [kind, kind === 'lock' ? route.locks : itinerary.counts[kind] ?? 0, one, many] as const).filter(([, n]) => n > 0);
  return (
    <section className="summary" aria-label="Route">
      {options.length > 1 && (
        <div className="chips route-options" role="group" aria-label="Route options">
          {options.map((r, i) => (
            <button key={i} type="button" className="chip" aria-pressed={i === chosen} onClick={() => onChoose?.(i)}>
              {optionName(options, i)} · {fmtDuration(r.duration)}
            </button>
          ))}
        </div>
      )}
      <div className="summary-head">
        <div className="big">{fmtDuration(route.duration)}</div>
        <div className="muted">
          {fmtKm(route.distance)} ({fmtNm(route.distance)}) · at {profile.speedKmh} km/h
          {route.duration > 8 * 3600 && ` · time underway, ${daysText(route, itinerary.stops)}`}
        </div>
      </div>
      {stats.length > 0 && (
        <ul className="stat-chips" aria-label="On the way">
          {stats.map(([kind, n, one, many]) => (
            <li key={kind}><img src={badgeUrl(kind)} alt="" width="18" height="18" />{n} {n === 1 ? one : many}</li>
          ))}
        </ul>
      )}
      {route.downstream + route.upstream > 0 && (
        <div className="small current">
          With the current {fmtKm(route.downstream)} · against it {fmtKm(route.upstream)} ({profile.currentMs} m/s)
          {back !== null && ` · return about ${fmtDuration(back)}`}
        </div>
      )}
      <Notices notices={notices} />
      <div className="action-row">
        <button type="button" className="pill primary start-nav" onClick={onStart}><Icon name="navigation" />Start</button>
        <button type="button" className="pill" aria-expanded={steps} onClick={() => { if (!steps) onStepsOpen(); setSteps(!steps); }}>
          <Icon name="steps" />Steps
        </button>
      </div>
      {steps && (
        <div className="steps">
          <ol className="legs">
            {route.legs.map((l, i) => (
              <li key={i}><span>{l.name || 'unnamed waterway'}</span><span>{fmtKm(l.distance)}</span></li>
            ))}
          </ol>
          <ItineraryView itinerary={itinerary} onSelect={onFocus} />
        </div>
      )}
      {waterways.length > 0 && (
        <details className="more">
          <summary>About the waterways ({waterways.length})</summary>
          <WaterwaysView waterways={waterways} />
        </details>
      )}
      {rules.length > 0 && (
        <details className="more">
          <summary>Rules by country ({rules.length})</summary>
          <RulesView rules={rules} inland={route.distance - route.sea > 1000} sea={route.sea > 0} />
        </details>
      )}
      <details className="more">
        <summary>More: offline map, brief for AI, GPX</summary>
        {more}
      </details>
    </section>
  );
}
