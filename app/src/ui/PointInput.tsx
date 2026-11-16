import { useEffect, useState } from 'react';
import type { LngLat } from '../graph/geo';
import { searchPlaces, type Place } from './search';

export interface Point {
  position: LngLat;
  label: string;
}

export function PointInput(props: {
  label: string;
  value: Point | null;
  picking: boolean;
  near?: LngLat;
  onPick: () => void;
  onMyPosition: () => void;
  onSelect: (p: Point | null) => void;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 3) return;
    const ctrl = new AbortController();
    const t = setTimeout(() => {
      searchPlaces(query, props.near, ctrl.signal)
        .then((r) => { setResults(r); setError(null); })
        .catch((e) => { if (!ctrl.signal.aborted) setError(e.message); });
    }, 300);
    return () => { clearTimeout(t); ctrl.abort(); };
  }, [query, props.near]);

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
      {error && <div className="error small">{error}</div>}
      {query.trim().length >= 3 && results.length > 0 && (
        <ul className="results">
          {results.map((r, i) => (
            <li key={i}>
              <button onClick={() => { props.onSelect({ position: r.position, label: r.label }); setQuery(''); setResults([]); }}>
                {r.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
