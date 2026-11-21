import { closedOn, type FishingRules, type FishingWaters, seasonText } from '../routing/fishing';
import { host } from './host';

const WATERS: [keyof Pick<FishingRules, 'inland' | 'sea'>, string][] = [['inland', 'Inland'], ['sea', 'At sea']];
const FIELDS: [keyof FishingWaters, string][] = [['licence', 'Licence'], ['permit', 'Permit for the water'], ['visitors', 'Visitors'],
  ['reporting', 'Catch reporting'], ['bans', 'Where not'], ['boat', 'From a boat']];

/** The fishing rules of a country: what is closed on the day, licences and permits, bans, and the season table. */
export function FishingRulesView({ rules, country, day }: { rules: FishingRules; country: string; day: string }) {
  const closed = closedOn(rules, day);
  return (
    <div className="fishing-rules">
      <h4>Fishing rules: {country}</h4>
      {closed.length > 0 && (
        <p className="warn small">Closed on {day}: {closed.map((s) => `${s.species} (${s.waters === 'all' ? 'all waters' : s.waters})`).join(', ')}.</p>
      )}
      {WATERS.map(([k, label]) => rules[k] && (
        <dl key={k} className="facts small">
          <div><dt>{label}</dt><dd /></div>
          {FIELDS.map(([f, name]) => rules[k]![f] && <div key={f}><dt>{name}</dt><dd>{rules[k]![f]}</dd></div>)}
        </dl>
      ))}
      {rules.seasons.length > 0 && (
        <details>
          <summary className="small">Closed seasons, sizes and limits ({rules.seasons.length})</summary>
          <ul className="small">{rules.seasons.map((s, i) => <li key={i}>{seasonText(s)} ({s.waters === 'all' ? 'all waters' : s.waters})</li>)}</ul>
        </details>
      )}
      <div className="small">
        {rules.buy && <><a href={rules.buy} target="_blank" rel="noreferrer">Buy a licence online</a> · </>}
        {rules.authority.url ? <a href={rules.authority.url} target="_blank" rel="noreferrer">{rules.authority.name}</a> : <span>{rules.authority.name}</span>}
      </div>
      <div className="small muted">Checked {rules.checked}. Rules change and vary by region and water: check before you fish.</div>
      <details className="small muted waterway-sources">
        <summary>Sources ({rules.sources.length})</summary>
        {rules.sources.map((s, i) => <span key={s}>{i > 0 && ', '}<a href={s} target="_blank" rel="noreferrer">{host(s)}</a></span>)}
      </details>
    </div>
  );
}
