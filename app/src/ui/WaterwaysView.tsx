import { host } from './host';
import { monthsText, rulesText, tideText, type WaterwayInfo } from '../routing/waterways';

const STATUS: Record<WaterwayInfo['navigable'], string> = {
  yes: 'navigable', seasonal: 'seasonal', restricted: 'restricted', closed: 'closed',
};


/** Researched facts about each waterway on the route: a card with its status and a one-line summary; the details
 *  and sources fold under it (open when there is only one). */
export function WaterwaysView({ waterways }: { waterways: WaterwayInfo[] }) {
  return (
    <ul className="waterways">
      {waterways.map((w) => {
        const facts: [string, string | null][] = [
          ['Gauge', w.class],
          ['Depth', [w.depth.usualM !== null && `usually ${w.depth.usualM} m`, w.depth.maxDraftM !== null && `draft up to ${w.depth.maxDraftM} m`, w.depth.notes]
            .filter(Boolean).join('; ') || null],
          ['Lowest bridge', w.airDraftM !== null ? `${w.airDraftM} m` : null],
          ['Current', [w.current.typicalMs !== null && `about ${w.current.typicalMs} m/s`, w.current.notes].filter(Boolean).join('; ') || null],
          ['Locks', [w.locks.count !== null && `${w.locks.count}`, w.locks.chamber, w.locks.hours, w.locks.notes].filter(Boolean).join('; ') || null],
          ['By month', monthsText(w)],
          ['Tides', tideText(w)],
          ['Rules', rulesText(w)],
          ['Best season', w.season.best],
          ['Closures', w.season.closures],
        ];
        const summary = [w.class && `class ${w.class}`, w.depth.maxDraftM !== null && `draft ≤ ${w.depth.maxDraftM} m`,
          w.airDraftM !== null && `bridges ≥ ${w.airDraftM} m`, w.locks.count !== null && `${w.locks.count} ${w.locks.count === 1 ? 'lock' : 'locks'}`].filter(Boolean).join(' · ');
        return (
          <li key={w.id} className="waterway-card">
            <div className="waterway-head">
              <strong>{w.name}</strong>
              <span className={`badge ${w.navigable}`}>{STATUS[w.navigable]}</span>
            </div>
            <div className="small muted">{w.reach} · checked {w.checked}</div>
            {summary && <div className="small waterway-sum">{summary}</div>}
            <details className="waterway-more" open={waterways.length === 1}>
              <summary>Details</summary>
            <dl className="small">
              {facts.filter(([, v]) => v).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
            {w.notes && <p className="small">{w.notes}</p>}
            <div className="small">
              {w.authority.url ? <a href={w.authority.url} target="_blank" rel="noreferrer">{w.authority.name}</a> : <span>{w.authority.name}</span>}
              {w.notices && <> · <a href={w.notices} target="_blank" rel="noreferrer">notices to skippers</a></>}
              {' · '}<a href={`?waterway=${encodeURIComponent(w.id)}`}>link to this sheet</a>
            </div>
            </details>
            <details className="small muted waterway-sources">
              <summary>Sources ({w.sources.length})</summary>
              {w.sources.map((s, i) => <span key={s}>{i > 0 && ', '}<a href={s} target="_blank" rel="noreferrer">{host(s)}</a></span>)}
            </details>
          </li>
        );
      })}
    </ul>
  );
}
