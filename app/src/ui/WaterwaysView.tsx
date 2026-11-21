import { tideText, type WaterwayInfo } from '../routing/waterways';

const STATUS: Record<WaterwayInfo['navigable'], string> = {
  yes: 'navigable', seasonal: 'seasonal', restricted: 'restricted', closed: 'closed',
};

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** Researched facts about each waterway on the route, with their sources. */
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
          ['Tides', tideText(w)],
          ['Best season', w.season.best],
          ['Closures', w.season.closures],
        ];
        return (
          <li key={w.id}>
            <div className="waterway-head">
              <strong>{w.name}</strong>
              <span className={`badge ${w.navigable}`}>{STATUS[w.navigable]}</span>
            </div>
            <div className="small muted">{w.reach} · checked {w.checked}</div>
            <dl className="small">
              {facts.filter(([, v]) => v).map(([k, v]) => (
                <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
              ))}
            </dl>
            {w.notes && <p className="small">{w.notes}</p>}
            <div className="small">
              {w.authority.url ? <a href={w.authority.url} target="_blank" rel="noreferrer">{w.authority.name}</a> : w.authority.name}
              {w.notices && <> · <a href={w.notices} target="_blank" rel="noreferrer">notices to skippers</a></>}
            </div>
            <div className="small muted">
              Sources:{' '}
              {w.sources.map((s, i) => <span key={s}>{i > 0 && ', '}<a href={s} target="_blank" rel="noreferrer">{host(s)}</a></span>)}
            </div>
          </li>
        );
      })}
    </ul>
  );
}
