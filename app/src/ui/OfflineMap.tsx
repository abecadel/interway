import { useMemo, useState } from 'react';
import type { LngLat } from '../graph/geo';
import { clearSaved, corridorUrls, corridorZoom, saveUrls } from '../offline/corridor';

type State =
  | { s: 'idle' }
  | { s: 'saving'; done: number; total: number }
  | { s: 'done'; saved: number; failed: number; zoom: number }
  | { s: 'error'; message: string };

/** "Save map for offline": basemap and seamark tiles along the route, kept until cleared. */
export function OfflineMap({ line }: { line: LngLat[] }) {
  const [state, setState] = useState<State>({ s: 'idle' });
  const zoom = useMemo(() => corridorZoom(line), [line]);

  const save = async (z: number) => {
    setState({ s: 'saving', done: 0, total: 0 });
    try {
      const urls = await corridorUrls(line, z);
      const r = await saveUrls(urls, (done, total) => setState({ s: 'saving', done, total }));
      setState({ s: 'done', ...r, zoom: z });
    } catch (e) {
      setState({ s: 'error', message: (e as Error).message });
    }
  };
  const clear = async () => {
    await clearSaved();
    setState({ s: 'idle' });
  };

  if (zoom === null) return <div className="small info">Route too long to save its map for offline use: save it in parts with waypoints.</div>;
  const start = () => void save(zoom);
  return (
    <div className="offline-map small">
      {state.s === 'idle' && <button onClick={start}>Save map for offline</button>}
      {state.s === 'saving' && <span>Saving map… {state.total ? `${state.done} / ${state.total}` : ''}</span>}
      {state.s === 'done' && (
        <span>
          Map saved along the route (zoom {state.zoom}){state.failed ? `, ${state.failed} tiles failed` : ''}.{' '}
          <button onClick={clear}>Clear saved maps</button>
        </span>
      )}
      {state.s === 'error' && (
        <span className="error">
          Could not save the map: {state.message} <button onClick={start}>Retry</button>
        </span>
      )}
    </div>
  );
}
