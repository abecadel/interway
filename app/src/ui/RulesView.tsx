import { ruleFacts, type CountryRules } from '../routing/rules';
import { host } from './WaterwaysView';

/** The boating rules of each country on the route, with their sources and the date they were checked. */
export function RulesView({ rules, inland, sea }: { rules: CountryRules[]; inland: boolean; sea: boolean }) {
  return (
    <ul className="waterways">
      {rules.map((r) => (
        <li key={r.cc}>
          <div className="waterway-head"><strong>{r.name}</strong></div>
          <div className="small muted">checked {r.checked}</div>
          <dl className="small">
            {ruleFacts(r, { inland, sea }).map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
          </dl>
          <div className="small">
            {r.authority.url ? <a href={r.authority.url} target="_blank" rel="noreferrer">{r.authority.name}</a> : r.authority.name}
          </div>
          <div className="small muted">
            Sources:{' '}
            {r.sources.map((s, i) => <span key={s}>{i > 0 && ', '}<a href={s} target="_blank" rel="noreferrer">{host(s)}</a></span>)}
          </div>
        </li>
      ))}
    </ul>
  );
}
