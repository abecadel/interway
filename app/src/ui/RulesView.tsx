import { ruleFacts, type CountryRules } from '../routing/rules';
import { host } from './host';

/** The boating rules of each country on the route, with their sources and the date they were checked. */
export function RulesView({ rules, inland, sea }: { rules: CountryRules[]; inland: boolean; sea: boolean }) {
  return (
    <ul className="waterways">
      {rules.map((r) => (
        <li key={r.cc} className="waterway-card">
          <div className="waterway-head"><strong>{r.name}</strong></div>
          <div className="small muted">checked {r.checked}</div>
          <dl className="small">
            {ruleFacts(r, { inland, sea }).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          <div className="small">
            {r.authority.url ? <a href={r.authority.url} target="_blank" rel="noreferrer">{r.authority.name}</a> : r.authority.name}
          </div>
          <details className="small muted waterway-sources">
            <summary>Sources ({r.sources.length})</summary>
            {r.sources.map((s, i) => <span key={s}>{i > 0 && ', '}<a href={s} target="_blank" rel="noreferrer">{host(s)}</a></span>)}
          </details>
        </li>
      ))}
    </ul>
  );
}
