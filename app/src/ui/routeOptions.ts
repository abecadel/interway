// How the route options are told apart: by name in the summary, by the time difference on the map.
import type { Route } from '../routing/router';
import { fmtDuration } from './format';

/** an option's waterways the best route does not use, longest (summed over its legs) first; "A / B" bilingual
 *  names by their first part */
function ownNames(options: Route[], i: number): [string, number][] {
  const best = new Set(options[0].legs.map((l) => l.name));
  const km = new Map<string, number>();
  for (const l of options[i].legs) {
    if (!l.name || best.has(l.name)) continue;
    const name = l.name.split(' / ')[0];
    km.set(name, (km.get(name) ?? 0) + l.distance);
  }
  return [...km].sort((a, b) => b[1] - a[1]);
}

/** a second waterway is named too when it is at least this share of the first ("Via Ottawa River and Rideau River") */
const SECOND_NAME = 0.3;

/** An alternative is named after its longest waterways that the best route does not use, and differently from the
 *  options before it. */
export function optionName(options: Route[], i: number): string {
  if (i === 0) return 'Best';
  const names = ownNames(options, i);
  if (!names.length) return `Option ${i + 1}`;
  const earlier = Array.from({ length: i - 1 }, (_, k) => optionName(options, k + 1));
  const shown = names.filter(([, d], k) => k < 2 && d >= SECOND_NAME * names[0][1]).map(([n]) => n);
  const label = `Via ${shown.join(' and ')}`;
  if (!earlier.includes(label)) return label;
  const other = names.find(([n]) => !earlier.some((e) => e.includes(n)));
  return other ? `Via ${other[0]}` : `Option ${i + 1}`;
}

/** an alternative on the map: how much longer (or shorter) than the chosen route */
export const timeDiff = (s: number) => `${s < 0 ? '−' : '+'}${fmtDuration(Math.abs(s))}`;
