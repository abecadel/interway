import { Icon } from './icons';
import type { Theme } from './useTheme';

const THEMES: [Theme, string][] = [['auto', 'Auto'], ['day', 'Day'], ['night', 'Night'], ['helm', 'Helm (red)']];

/** Map type and overlays, opened from the round layers button. */
export function LayersCard({ theme, setTheme, seamarks, setSeamarks, network, setNetwork, onClose, about }: {
  /** what data is loaded (region, nodes, edges) */
  about?: string;
  theme: Theme;
  setTheme: (t: Theme) => void;
  seamarks: boolean;
  setSeamarks: (v: boolean) => void;
  network: boolean;
  setNetwork: (v: boolean) => void;
  onClose: () => void;
}) {
  return (
    <section className="layers-card" aria-label="Layers">
      <header className="sheet-title">
        <h2>Map type</h2>
        <button type="button" className="icon-btn" aria-label="Close layers" onClick={onClose}><Icon name="close" /></button>
      </header>
      <div className="map-types" role="group" aria-label="Colours">
        {THEMES.map(([t, label]) => (
          <button key={t} type="button" className={`map-type map-type-${t}`} aria-pressed={theme === t} onClick={() => setTheme(t)}>
            <span className="thumb" />{label}
          </button>
        ))}
      </div>
      <h3>Map details</h3>
      <label className="check"><input type="checkbox" checked={seamarks} onChange={(e) => setSeamarks(e.target.checked)} /> OpenSeaMap seamarks</label>
      <label className="check"><input type="checkbox" checked={network} onChange={(e) => setNetwork(e.target.checked)} /> Routable network (debug)</label>
      {about && <p className="small muted">Data: {about}</p>}
    </section>
  );
}
