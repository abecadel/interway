import type { Poi } from '../routing/service';

export interface Fact {
  label: string;
  value: string;
  href?: string;
}

const metres = (v: string) => (/^\d+([.,]\d+)?$/.test(v.trim()) ? `${v.trim()} m` : v);

/** What is known about a harbour, marina or fuel berth, as labelled lines (links for web, phone and e-mail). */
export function portFacts(p: Poi): Fact[] {
  const out: Fact[] = [];
  if (p.services) out.push({ label: 'Services', value: p.services });
  if (p.berths) out.push({ label: 'Berths', value: p.berths });
  if (p.boatlength) out.push({ label: 'Boats up to', value: metres(p.boatlength) });
  if (p.depth) out.push({ label: 'Depth', value: metres(p.depth) });
  if (p.vhf) out.push({ label: 'VHF', value: /^\d+$/.test(p.vhf) ? `channel ${p.vhf}` : p.vhf });
  if (p.hours) out.push({ label: 'Hours', value: p.hours });
  if (p.phone) out.push({ label: 'Phone', value: p.phone, href: `tel:${p.phone.replace(/[^+\d]/g, '')}` });
  if (p.email) out.push({ label: 'E-mail', value: p.email, href: `mailto:${p.email}` });
  if (p.website) {
    const href = /^https?:\/\//.test(p.website) ? p.website : `https://${p.website}`;
    out.push({ label: 'Website', value: p.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''), href });
  }
  if (p.operator) out.push({ label: 'Operator', value: p.operator });
  return out;
}
