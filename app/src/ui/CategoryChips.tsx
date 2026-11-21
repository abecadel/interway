import type { LngLat } from '../graph/geo';
import type { Poi, PoiType } from '../routing/service';
import { CATEGORIES, nearest } from './categories';
import { fmtKm, POI_LABEL } from './format';
import { Icon } from './icons';
import { badgeUrl } from '../map/sprites';


/** Category chips under the search box. */
export function CategoryChips({ active, onSelect }: { active: PoiType | null; onSelect: (t: PoiType | null) => void }) {
  return (
    <div className="chips" role="toolbar" aria-label="Find nearby">
      {CATEGORIES.map(([type, label]) => (
        <button key={type} type="button" className="chip" aria-pressed={active === type} onClick={() => onSelect(active === type ? null : type)}>
          {type !== 'place' && <img src={badgeUrl(type)} alt="" width="16" height="16" />}{label}
        </button>
      ))}
    </div>
  );
}

export function CategoryList({ pois, type, center, onSelect, onClose }: {
  pois: Poi[];
  type: PoiType;
  center: LngLat;
  onSelect: (p: Poi) => void;
  onClose: () => void;
}) {
  const label = CATEGORIES.find(([t]) => t === type)![1];
  const near = nearest(pois, type, center);
  return (
    <section className="category-list" aria-label={label}>
      <header className="sheet-title">
        <h2>{label} nearby</h2>
        <button type="button" className="icon-btn" aria-label="Close list" onClick={onClose}><Icon name="close" /></button>
      </header>
      {near.length === 0 && <p className="empty-state small">None in the data near here: move the map to look elsewhere, or search for a place.</p>}
      <ul className="place-list">
        {near.map(({ poi, d }, i) => (
          <li key={i}>
            <button type="button" onClick={() => onSelect(poi)}>
              <span className="name">{poi.name || POI_LABEL[poi.type]}</span>
              <span className="dist">{fmtKm(d)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
