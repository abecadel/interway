import { Icon } from './icons';
import { useState } from 'react';
import type { LngLat } from '../graph/geo';
import type { LocalIndex } from './localSearch';
import { usePlaceSearch } from './usePlaceSearch';

export interface Point {
  position: LngLat;
  label: string;
}

export function PointInput(props: {
  label: string;
  value: Point | null;
  picking: boolean;
  near?: LngLat;
  /** waterway places from the downloaded data: searched at once, and the only results offline */
  local?: LocalIndex;
  onPick: () => void;
  onMyPosition: () => void;
  onSelect: (p: Point | null) => void;
}) {
  const [query, setQuery] = useState('');
  const { results, note, noteIsError } = usePlaceSearch(query, props.near, props.local);

  return (
    <div className="point-input">
      <div className="point-row">
        <span className="point-label">{props.label}</span>
        <input
          placeholder={props.value ? props.value.label : 'Search place or click the map'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {props.value && <button title="Clear" aria-label="Clear" onClick={() => props.onSelect(null)}><Icon name="close" size={18} /></button>}
      </div>
      <div className="point-actions">
        <button onClick={props.onMyPosition}>My position</button>
        <button className={props.picking ? 'active' : ''} onClick={props.onPick}>
          {props.picking ? 'Click on the map…' : 'Pick on map'}
        </button>
      </div>
      {note && <div className={noteIsError ? 'error small' : 'info small'}>{note}</div>}
      {results.length > 0 && (
        <ul className="results">
          {results.map((r, i) => (
            <li key={i}>
              <button onClick={() => { props.onSelect({ position: r.position, label: r.label }); setQuery(''); }}>
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
