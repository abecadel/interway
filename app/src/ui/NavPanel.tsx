import type { Upcoming } from '../nav/progress';
import type { Navigation } from '../nav/useNavigation';
import { trackGpx } from '../nav/track';
import { download } from './download';
import { fmtDuration, fmtKm } from './format';
import { Icon } from './icons';
import { badgeUrl } from '../map/sprites';

const KIND: Record<Upcoming['kind'], string> = { lock: 'Lock', bridge: 'Bridge', end: 'Destination' };
const what = (e: Upcoming) => (e.kind === 'end' ? KIND.end : e.name || KIND[e.kind]);
const KN = 3600 / 1852;
const BADGE = { lock: 'lock', bridge: 'bridge', end: 'port' } as const;

/** a data tile with nothing to show yet */
const none = <>—<small>no GPS fix</small></>;

/** The heads-up panel over the map while navigating: next event, speed, course, cross-track error and ETA.
 *  After sunset it offers the red helm light (`onHelm`). */
export function NavPanel({ nav, onHelm }: { nav: Navigation; onHelm?: () => void }) {
  const { progress: p, motion: m } = nav;
  const arrival = p ? new Date(p.time + p.eta * 1000) : null;
  return (
    <section className="nav-panel" aria-label="Navigation">
      <div className="nav-banner">
        {!p && <div className="nav-next">Waiting for GPS…</div>}
        {p?.arrived && <div className="nav-next">Arrived</div>}
        {p && !p.arrived && p.next && (
          <div className="nav-next">
            <img className="nav-badge" src={badgeUrl(BADGE[p.next.kind])} alt="" width="34" height="34" />
            <div>
              <div className="nav-kind">{KIND[p.next.kind]} in</div>
              <b>{fmtKm(p.next.distance)}</b>
              {(p.next.name || p.next.detail) && <div className="nav-name">{[p.next.name, p.next.detail].filter(Boolean).join(' · ')}</div>}
            </div>
          </div>
        )}
        {p && !p.arrived && p.upcoming.length > 1 && (
          <ol className="nav-then small">
            {p.upcoming.slice(1).map((e, i) => <li key={i}>then {what(e)} in {fmtKm(e.distance)}</li>)}
          </ol>
        )}
        {nav.rerouting && <div className="nav-reroute">Off the route: re-routing from here…</div>}
      </div>
      <div className="nav-bottom">
        <dl className="nav-data">
          <div><dt>SOG</dt><dd>{m?.sog != null ? <>{(m.sog * KN).toFixed(1)}<span className="unit"> kn</span><small>{(m.sog * 3.6).toFixed(1)} km/h</small></> : none}</dd></div>
          <div><dt>COG</dt><dd>{m?.cog != null ? `${Math.round(m.cog).toString().padStart(3, '0')}°` : none}</dd></div>
          <div><dt>XTE</dt><dd>{p ? <>{Math.round(p.crossTrack)}<span className="unit"> m</span><small>{p.side ? `${p.side} of route` : 'on the line'}</small></> : none}</dd></div>
        </dl>
        {!nav.follow && <button className="nav-recenter" onClick={() => nav.setFollow(true)}>Recenter</button>}
        <div className="nav-row">
          <div className="nav-eta">
            <b>{p ? fmtDuration(p.eta) : '–'}</b>
            <span>{p ? fmtKm(p.remaining) : ''}{p && arrival ? ` · ${arrival.toTimeString().slice(0, 5)}` : ''}</span>
          </div>
          <div className="nav-actions">
            {onHelm && <button onClick={onHelm} title="Red light keeps your night vision">Red light</button>}
            <button className="nav-voice" aria-pressed={nav.voice} aria-label={nav.voice ? 'Voice on' : 'Voice off'} onClick={() => nav.setVoice(!nav.voice)}>
              <Icon name={nav.voice ? 'volumeUp' : 'volumeOff'} />
            </button>
            {nav.track.length > 1 && (
              <button onClick={() => download(trackGpx(nav.track), 'application/gpx+xml', 'interway-track.gpx')}>Track GPX</button>
            )}
            <button className="nav-stop" onClick={nav.stop}>End</button>
          </div>
        </div>
      </div>
    </section>
  );
}
