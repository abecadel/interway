import { type ReactNode, useState } from 'react';
import type { Itinerary } from '../routing/itinerary';
import type { Route, VesselProfile } from '../routing/router';
import { fmtDuration, fmtKm, fmtNm } from './format';
import { Icon } from './icons';
import { ItineraryView } from './ItineraryView';
import { legPoints, seasonWarnings, waterwaysOn, waterwayWarnings } from '../routing/waterways';
import { WaterwaysView } from './WaterwaysView';

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
  const warnings = [...waterwayWarnings(waterways, profile.draft, profile.airDraft), ...seasonWarnings(route, profile)];
  return (
    <section className="summary" aria-label="Route">
      {options.length > 1 && (
        <div className="chips route-options" role="group" aria-label="Route options">
          {options.map((r, i) => (
            <button key={i} type="button" className="chip" aria-pressed={i === chosen} onClick={() => onChoose?.(i)}>
              {fmtDuration(r.duration)} · {fmtKm(r.distance)}{i === 0 ? ' · best' : ''}
            </button>
          ))}
        </div>
      )}
      <div className="summary-head">
        <div className="big">{fmtDuration(route.duration)}</div>
        <div className="muted">
          {fmtKm(route.distance)} ({fmtNm(route.distance)}) · {route.locks} {route.locks === 1 ? 'lock' : 'locks'} · at {profile.speedKmh} km/h
        </div>
      </div>
      {route.downstream + route.upstream > 0 && (
        <div className="small current">
          With the current {fmtKm(route.downstream)} · against it {fmtKm(route.upstream)} ({profile.currentMs} m/s)
          {back !== null && ` · return about ${fmtDuration(back)}`}
        </div>
      )}
      {(route.start.offset > 200 || route.end.offset > 200) && (
        <div className="warn small">
          Start/end snapped to the nearest navigable water ({fmtKm(route.start.offset)} / {fmtKm(route.end.offset)} away).
        </div>
      )}
      {route.noMotor > 500 && (
        <div className="warn small">
          {fmtKm(route.noMotor)} on waters where OpenStreetMap says motorboats are not allowed, with no other way. Check the local rules.
        </div>
      )}
      {route.unverified > 0 && (
        <div className="warn small">
          Includes {fmtKm(route.unverified)} on unverified connections (short channels or manual links). Check locally before going.
        </div>
      )}
      {route.sea > 0 && (
        <div className="warn small">
          {fmtNm(route.sea)} on open sea: check the weather, tides, traffic schemes and official charts before going.
          {route.shallowest && ` Shallowest stretch allows about ${route.shallowest.draft} m draft (km ${(route.shallowest.at / 1000).toFixed(0)}).`}
          {route.seaNoDepth > 0 && ` Depth unknown for ${fmtNm(route.seaNoDepth)}: no charted depth in the planner there.`}
          {route.tooShallow > 0 && ` ${(route.tooShallow / 1000).toFixed(0)} km charted shallower than your draft: check charts for a channel.`}
        </div>
      )}
      {warnings.length > 0 && <div className="warn small">{warnings.join(' ')}</div>}
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
      <details className="more">
        <summary>More: offline map, brief for AI, GPX</summary>
        {more}
      </details>
    </section>
  );
}
