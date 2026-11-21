// How the route options are told apart: by name in the summary, by the time difference on the map.
import type { Route } from '../routing/router';
import { fmtDuration } from './format';

/** An alternative is named after its longest waterway that the best route does not use. */
export function optionName(options: Route[], i: number): string {
  if (i === 0) return 'Best';
  const best = new Set(options[0].legs.map((l) => l.name));
  const own = options[i].legs.filter((l) => l.name && !best.has(l.name)).sort((a, b) => b.distance - a.distance)[0];
  return own ? `Via ${own.name}` : `Option ${i + 1}`;
}

/** an alternative on the map: how much longer (or shorter) than the chosen route */
export const timeDiff = (s: number) => `${s < 0 ? '−' : '+'}${fmtDuration(Math.abs(s))}`;
