import { useEffect, useMemo, useState } from 'react';
import type { LngLat } from '../graph/geo';
import { mergePlaces, type LocalIndex } from './localSearch';
import { searchPlaces, type Place } from './search';

/** Places for a typed query: the downloaded waterway places at once, online (Photon) results added after a pause. */
export function usePlaceSearch(query: string, near?: LngLat, local?: LocalIndex) {
  const [online, setOnline] = useState<{ query: string; places: Place[] }>({ query: '', places: [] });
  const [error, setError] = useState<{ query: string; message: string } | null>(null);
  const localResults = useMemo(() => (local && query.trim().length >= 2 ? local.search(query, near) : []), [local, query, near]);
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
  const results = query.trim().length >= 2 ? mergePlaces(localResults, online.query === query ? online.places : []) : [];
  const failed = error?.query === query ? error.message : null;
  // offline with local hits: say so quietly; nothing at all: show the error
  const note = failed ? (localResults.length ? 'Offline: showing waterway places only' : failed) : null;
  return { results, note, noteIsError: !!failed && !localResults.length };
}
