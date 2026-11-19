// Spoken and vibrating warnings ahead of locks, bridges and the destination.
import type { Progress, Upcoming } from './progress';

/** metres before an event at which to warn, farthest first */
export const ALERT_AT = [1000, 200];

export interface Alert {
  key: string;
  text: string;
}

const KIND: Record<Upcoming['kind'], string> = { lock: 'Lock', bridge: 'Bridge', end: 'Destination' };
const spoken = (m: number) => (m === 1000 ? '1 kilometre' : `${m} metres`);

/**
 * Warnings due at this fix that `done` does not hold yet. An event is identified by its kind, name and distance to
 * the destination, which a re-route from the boat does not change, so a warning is never repeated. Crossing
 * several thresholds at once (navigation started close to a lock) gives only the nearest.
 */
export function dueAlerts(p: Progress, done: Set<string>): Alert[] {
  const out: Alert[] = [];
  const end = p.along + p.remaining;
  if (p.arrived) {
    if (!done.has('arrived')) {
      done.add('arrived');
      out.push({ key: 'arrived', text: 'You have arrived' });
    }
    return out;
  }
  for (const e of p.upcoming) {
    const id = `${e.kind}:${e.name}:${Math.round((end - e.at) / 100)}`;
    const crossed = ALERT_AT.filter((m) => e.distance <= m);
    if (!crossed.length) continue;
    const fresh = crossed.filter((m) => !done.has(`${id}:${m}`));
    crossed.forEach((m) => done.add(`${id}:${m}`));
    if (fresh.length) {
      const m = Math.min(...crossed);
      out.push({ key: `${id}:${m}`, text: `${e.kind === 'end' ? KIND.end : e.name || KIND[e.kind]} in ${spoken(m)}` });
    }
  }
  return out;
}

/** Vibrate, and speak when voice is on; silently does what the device supports. */
export function announce(a: Alert, voice: boolean) {
  navigator.vibrate?.([200, 100, 200]);
  if (voice && typeof speechSynthesis !== 'undefined' && typeof SpeechSynthesisUtterance !== 'undefined') {
    speechSynthesis.speak(new SpeechSynthesisUtterance(a.text));
  }
}
