import type { PortSheet } from '../routing/ports';

const link = (href: string) => /^https?:\/\//.test(href) ? href : `https://${href}`;
const host = (href: string) => href.replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, '');

/** A researched port sheet: key facts first, then approach, notes and sources. */
export function PortGuide({ port }: { port: PortSheet }) {
  const rows: [string, string | null, string?][] = [
    ['Berths', [port.berths !== null && `${port.berths}`, port.visitorBerths !== null && `${port.visitorBerths} for visitors`].filter(Boolean).join(', ') || null],
    ['Boats up to', port.maxLengthM !== null ? `${port.maxLengthM} m` : null],
    ['Depth', port.depthM !== null ? `${port.depthM} m` : null],
    ['VHF', port.vhf && (/^\d+$/.test(port.vhf) ? `channel ${port.vhf}` : port.vhf)],
    ['Fuel', port.fuel],
    ['Facilities', port.facilities.length ? port.facilities.join(', ') : null],
    ['Fees', port.fees],
    ['Season', port.season],
    ['Approach', port.approach],
    ['Notes', port.notes],
    ['Phone', port.phone, port.phone ? `tel:${port.phone.replace(/[^+\d]/g, '')}` : undefined],
    ['E-mail', port.email, port.email ? `mailto:${port.email}` : undefined],
    ['Website', port.website && host(port.website), port.website ? link(port.website) : undefined],
    ['Booking', port.booking && host(port.booking), port.booking ? link(port.booking) : undefined],
  ];
  return (
    <div className="port-guide">
      <div className="small muted">{port.name} · {port.kind} · checked {port.checked}</div>
      <dl className="facts small port-facts">
        {rows.filter(([, v]) => v).map(([label, value, href]) => (
          <div key={label}>
            <dt>{label}</dt>
            <dd>{href ? <a href={href} target={href.startsWith('http') ? '_blank' : undefined} rel="noreferrer">{value}</a> : value}</dd>
          </div>
        ))}
      </dl>
      <details className="small">
        <summary>Sources</summary>
        <ul>{port.sources.map((s) => <li key={s}><a href={s} target="_blank" rel="noreferrer">{host(s)}</a></li>)}</ul>
      </details>
      <p className="small muted">Researched from the sources above; prices and hours change, so check with the harbour before you go.</p>
    </div>
  );
}
