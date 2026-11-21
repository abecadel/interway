import { useState } from 'react';
import type { LngLat } from '../graph/geo';
import { fmtKm, fmtPos } from './format';
import { Icon } from './icons';
import type { Fact } from './portFacts';
import { shareLink } from './places';

/** A place shown in the sheet: a search result, a tapped lock or marina, or a dropped pin. */
export interface PlaceInfo {
  label: string;
  position: LngLat;
  /** "Lock", "Marina", "Dropped pin"... */
  kind?: string;
  /** chamber size or clearance */
  detail?: string;
  /** metres from the route start, when the place is on the route */
  at?: number;
  /** metres off the route line */
  offset?: number;
  /** what is known about a harbour or marina (OSM) */
  facts?: Fact[];
}

export function PlaceCard({ place, saved, onDirections, onFrom, onToggleSave, onClose }: {
  place: PlaceInfo;
  saved: boolean;
  onDirections: () => void;
  onFrom: () => void;
  onToggleSave: () => void;
  onClose: () => void;
}) {
  const [shared, setShared] = useState(false);
  const share = () => {
    const url = shareLink(place.position);
    const nav = navigator as Navigator & { share?: (d: ShareData) => Promise<void> };
    const done = () => { setShared(true); setTimeout(() => setShared(false), 2000); };
    if (nav.share) nav.share({ title: place.label, url }).catch(() => {});
    else nav.clipboard.writeText(url).then(done, () => {});
  };
  return (
    <section className="place-card" aria-label="Place">
      <header className="sheet-title">
        <div>
          <h2>{place.label}</h2>
          <div className="muted small">
            {[place.kind, place.detail].filter(Boolean).join(' · ')}
          </div>
        </div>
        <button type="button" className="icon-btn" aria-label="Close place" onClick={onClose}><Icon name="close" /></button>
      </header>
      <div className="action-row">
        <button type="button" className="pill primary" onClick={onDirections}><Icon name="directions" />Directions</button>
        <button type="button" className="pill" onClick={onFrom}><Icon name="navigation" />Start here</button>
        <button type="button" className="pill" aria-pressed={saved} onClick={onToggleSave}>
          <Icon name={saved ? 'star' : 'starOutline'} />{saved ? 'Saved' : 'Save'}
        </button>
        <button type="button" className="pill" onClick={share}><Icon name="share" />{shared ? 'Link copied' : 'Share'}</button>
      </div>
      <ul className="facts small">
        {place.at !== undefined && <li>km {(place.at / 1000).toFixed(1)} on the route</li>}
        {place.offset !== undefined && place.offset > 60 && <li>{fmtKm(place.offset)} off the route</li>}
        <li className="muted">{fmtPos(place.position)}</li>
      </ul>
      {place.facts && place.facts.length > 0 && (
        <dl className="facts small port-facts">
          {place.facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.href ? <a href={f.href} target={f.href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{f.value}</a> : f.value}</dd>
            </div>
          ))}
          <div className="muted"><dt>Source</dt><dd>OpenStreetMap: check with the harbour before you go</dd></div>
        </dl>
      )}
    </section>
  );
}
