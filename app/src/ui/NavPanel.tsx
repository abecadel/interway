import type { Upcoming } from '../nav/progress';
import type { Navigation } from '../nav/useNavigation';
import { trackGpx } from '../nav/track';
import { download } from './download';
import { fmtDuration, fmtKm } from './format';

const KIND: Record<Upcoming['kind'], string> = { lock: 'Lock', bridge: 'Bridge', end: 'Destination' };
const what = (e: Upcoming) => (e.kind === 'end' ? KIND.end : e.name || KIND[e.kind]);
const KN = 3600 / 1852;

/** The heads-up panel over the map while navigating: next event, speed, course, cross-track error and ETA. */
export function NavPanel({ nav }: { nav: Navigation }) {
  const { progress: p, motion: m } = nav;
  const arrival = p ? new Date(p.time + p.eta * 1000) : null;
  return (
    <section className="nav-panel" aria-label="Navigation">
      {!p && <div className="nav-next">Waiting for GPS…</div>}
      {p?.arrived && <div className="nav-next">Arrived</div>}
      {p && !p.arrived && p.next && (
        <div className="nav-next">
          {p.next.kind !== 'end' && p.next.name && <span className="nav-kind">{KIND[p.next.kind]} </span>}
          {what(p.next)} in <b>{fmtKm(p.next.distance)}</b>
        </div>
      )}
      {p && !p.arrived && p.upcoming.length > 1 && (
        <ol className="nav-then small">
          {p.upcoming.slice(1).map((e, i) => <li key={i}>then {what(e)} in {fmtKm(e.distance)}</li>)}
        </ol>
      )}
      {nav.rerouting && <div className="warn">Off the route: re-routing from here…</div>}
      <dl className="nav-data">
        <div><dt>SOG</dt><dd>{m?.sog != null ? `${(m.sog * KN).toFixed(1)} kn` : '–'}<small>{m?.sog != null ? `${(m.sog * 3.6).toFixed(1)} km/h` : ''}</small></dd></div>
        <div><dt>COG</dt><dd>{m?.cog != null ? `${Math.round(m.cog).toString().padStart(3, '0')}°` : '–'}</dd></div>
        <div><dt>XTE</dt><dd>{p ? `${Math.round(p.crossTrack)} m` : '–'}<small>{p?.side ? `${p.side} of route` : ''}</small></dd></div>
        <div><dt>To go</dt><dd>{p ? fmtKm(p.remaining) : '–'}<small>{p && arrival ? `${fmtDuration(p.eta)} · ${arrival.toTimeString().slice(0, 5)}` : ''}</small></dd></div>
      </dl>
      <div className="nav-actions">
        <button aria-pressed={nav.voice} onClick={() => nav.setVoice(!nav.voice)}>{nav.voice ? 'Voice on' : 'Voice off'}</button>
        {nav.track.length > 1 && (
          <button onClick={() => download(trackGpx(nav.track), 'application/gpx+xml', 'interway-track.gpx')}>Track GPX</button>
        )}
        {!nav.follow && <button onClick={() => nav.setFollow(true)}>Recenter</button>}
        <button className="nav-stop" onClick={nav.stop}>Stop</button>
      </div>
    </section>
  );
}
