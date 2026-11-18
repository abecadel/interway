import { useEffect, useMemo, useState } from 'react';
import type { LngLat } from '../graph/geo';
import { searchPlaces, type Place } from './search';
import { mergePlaces, type LocalIndex } from './localSearch';

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
  const [online, setOnline] = useState<{ query: string; places: Place[] }>({ query: '', places: [] });
  const [error, setError] = useState<{ query: string; message: string } | null>(null);
  const { near, local } = props;
  const localResults = useMemo(() => (local && query.trim().length >= 2 ? local.search(query, near) : []), [local, query, near]);
  const results = mergePlaces(localResults, online.query === query ? online.places : []);
  const failed = error?.query === query ? error.message : null;

  useEffect(() => {
    if (query.trim().length < 3) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchPlaces(query, near, ctrl.signal)
        .then((r) => { setOnline({ query, places: r }); setError(null); })
        .catch((e) => { if (!ctrl.signal.aborted) setError({ query, message: e.message }); });
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query, near]);

  return (
    <div className="point-input">
      <div className="point-row">
        <span className="point-label">{props.label}</span>
        <input
          placeholder={props.value ? props.value.label : 'Search place or click the map'}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        {props.value && <button title="Clear" onClick={() => props.onSelect(null)}>✕</button>}
      </div>
      <div className="point-actions">
        <button onClick={props.onMyPosition}>My position</button>
        <button className={props.picking ? 'active' : ''} onClick={props.onPick}>
          {props.picking ? 'Click on the map…' : 'Pick on map'}
        </button>
      </div>
      {failed && (
        <div className={localResults.length ? 'info small' : 'error small'}>
          {localResults.length ? 'Offline: showing waterway places only' : failed}
        </div>
      )}
      {query.trim().length >= 2 && results.length > 0 && (
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
