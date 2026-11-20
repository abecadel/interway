import { type RefObject, useState } from 'react';
import type { LngLat } from '../graph/geo';
import { Icon } from './icons';
import type { LocalIndex } from './localSearch';
import type { Place } from './search';
import { usePlaceSearch } from './usePlaceSearch';

/** The floating search box: places as you type, saved and recent places while it is empty. */
export function SearchBar({ near, local, recent, saved, onSelect, onDirections, inputRef }: {
  near?: LngLat;
  local?: LocalIndex;
  recent: Place[];
  saved: Place[];
  onSelect: (p: Place) => void;
  onDirections: () => void;
  inputRef?: RefObject<HTMLInputElement | null>;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const { results, note, noteIsError } = usePlaceSearch(query, near, local);
  const choose = (p: Place) => {
    onSelect(p);
    setQuery('');
    setOpen(false);
  };
  const empty = query.trim().length < 2;
  const suggestions = [...saved.map((p) => ({ p, icon: 'star' as const })), ...recent.map((p) => ({ p, icon: 'history' as const }))];
  const list = empty ? (open ? suggestions : []) : results.map((p) => ({ p, icon: 'pin' as const }));
  return (
    <div className="searchbar" role="search">
      <div className="search-pill">
        <Icon name="search" />
        <input
          ref={inputRef} aria-label="Search" placeholder="Search marinas, locks, towns" value={query}
          onChange={(e) => { setQuery(e.target.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => { if (e.key === 'Escape') { setQuery(''); e.currentTarget.blur(); } }}
        />
        {query && (
          <button type="button" className="icon-btn" aria-label="Clear search" onClick={() => setQuery('')}><Icon name="close" /></button>
        )}
        <button type="button" className="icon-btn directions-btn" aria-label="Directions" title="Directions" onClick={onDirections}>
          <Icon name="directions" size={22} />
        </button>
      </div>
      {note && !empty && <div className={noteIsError ? 'error small search-note' : 'info small search-note'}>{note}</div>}
      {list.length > 0 && (
        // mousedown would blur the input (closing the list) before the click lands
        <ul className="search-results" onMouseDown={(e) => e.preventDefault()}>
          {list.map(({ p, icon }, i) => (
            <li key={i}>
              <button type="button" onClick={() => choose(p)}><Icon name={icon} />{p.label}</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
