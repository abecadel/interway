import { type Catch, catchesCsv, catchesGeoJson, catchesGpx } from './catches';
import { Icon } from './icons';

/** My catches: the private log, newest first, with exports. */
export function CatchList({ catches, onRemove, onOpen, onClose, download }: {
  catches: Catch[];
  onRemove: (id: string) => void;
  onOpen: (c: Catch) => void;
  onClose: () => void;
  download: (text: string, type: string, name: string) => void;
}) {
  return (
    <section className="category-list" aria-label="My catches">
      <header className="sheet-title">
        <h2>My catches</h2>
        <button type="button" className="icon-btn" aria-label="Close catches" onClick={onClose}><Icon name="close" /></button>
      </header>
      {catches.length === 0 ? <p className="info small">No catches yet: open a place and choose "Log a catch here".</p> : (
        <>
          <ul className="place-list">
            {catches.map((c) => (
              <li key={c.id}>
                <button type="button" onClick={() => onOpen(c)}>
                  <span className="name">{c.species}{c.lengthCm ? `, ${c.lengthCm} cm` : ''}{c.weightKg ? `, ${c.weightKg} kg` : ''}{c.released ? ' (released)' : ''}</span>
                  <span className="muted small">{new Date(c.time).toLocaleString()} · {c.place}</span>
                </button>
                <button type="button" className="icon-btn" aria-label={`Delete ${c.species}`} onClick={() => onRemove(c.id)}><Icon name="close" size={18} /></button>
              </li>
            ))}
          </ul>
          <div className="exports">
            <button type="button" onClick={() => download(catchesCsv(catches), 'text/csv', 'interway-catches.csv')}>CSV</button>
            <button type="button" onClick={() => download(catchesGpx(catches), 'application/gpx+xml', 'interway-catches.gpx')}>GPX</button>
            <button type="button" onClick={() => download(catchesGeoJson(catches), 'application/geo+json', 'interway-catches.geojson')}>GeoJSON</button>
          </div>
        </>
      )}
      <p className="small muted">Your catches stay in this browser only: export them to keep a copy.</p>
    </section>
  );
}
