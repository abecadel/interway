import type { Itinerary } from '../routing/itinerary';
import type { PoiType } from '../routing/service';
import { fmtKm, POI_LABEL, poiDetail } from './format';

const SUMMARY: PoiType[] = ['lock', 'fuel', 'marina', 'port', 'slipway', 'water', 'sanitary'];

/** "Along the route": counts per kind and the stops in order with their kilometre. */
export function ItineraryView({ itinerary, onSelect }: { itinerary: Itinerary; onSelect: (lon: number, lat: number) => void }) {
  const { stops, counts, minClearance } = itinerary;
  if (!stops.length) return <div className="small info">No locks, bridges or services known along this route.</div>;
  const parts = SUMMARY.filter((t) => counts[t]).map((t) => `${counts[t]} ${POI_LABEL[t].toLowerCase()}`);
  if (minClearance !== undefined) parts.push(`lowest bridge ${minClearance.toFixed(1)} m`);
  return (
    <details className="itinerary" open>
      <summary>Along the route</summary>
      <div className="small">{parts.join(' · ')}</div>
      <ol className="stops">
        {stops.map((s, i) => (
          <li key={i} className={`stop stop-${s.poi.type}`}>
            <button onClick={() => onSelect(s.poi.lon, s.poi.lat)}>
              <span className="km">km {(s.at / 1000).toFixed(1)}</span>
              <span className="kind">{POI_LABEL[s.poi.type]}</span>
              <span className="name">{s.poi.name}</span>
              <span className="detail">{[poiDetail(s.poi), s.offset > 60 ? `${fmtKm(s.offset)} off` : ''].filter(Boolean).join(', ')}</span>
            </button>
          </li>
        ))}
      </ol>
    </details>
  );
}
