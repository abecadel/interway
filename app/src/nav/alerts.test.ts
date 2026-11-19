import { afterEach, describe, expect, it, vi } from 'vitest';
import { announce, dueAlerts } from './alerts';
import type { Progress, Upcoming } from './progress';

const ev = (kind: Upcoming['kind'], name: string, at: number, along: number): Upcoming => ({ kind, name, at, distance: at - along });
const progress = (along: number, events: [Upcoming['kind'], string, number][], total = 20_000, arrived = false): Progress => ({
  time: 0, along, crossTrack: 0, side: null, remaining: total - along, eta: 0, offCount: 0, offRoute: false, arrived,
  next: null, upcoming: events.map(([k, n, at]) => ev(k, n, at, along)).filter((e) => e.distance > 0),
});

afterEach(() => vi.unstubAllGlobals());

describe('dueAlerts', () => {
  it('warns once at 1 km and once at 200 m before each event', () => {
    const done = new Set<string>();
    const events: [Upcoming['kind'], string, number][] = [['lock', 'Liepe', 5000], ['bridge', '', 5500], ['end', '', 20_000]];
    expect(dueAlerts(progress(3000, events), done)).toEqual([]);
    expect(dueAlerts(progress(4100, events), done).map((a) => a.text)).toEqual(['Liepe in 1 kilometre']);
    expect(dueAlerts(progress(4200, events), done)).toEqual([]);
    expect(dueAlerts(progress(4600, events), done).map((a) => a.text)).toEqual(['Bridge in 1 kilometre']);
    expect(dueAlerts(progress(4850, events), done).map((a) => a.text)).toEqual(['Liepe in 200 metres']);
    expect(dueAlerts(progress(19_000, events), done).map((a) => a.text)).toEqual(['Destination in 1 kilometre']);
    expect(dueAlerts(progress(19_950, events, 20_000, true), done).map((a) => a.text)).toEqual(['You have arrived']);
    expect(dueAlerts(progress(19_990, events, 20_000, true), done)).toEqual([]);
  });

  it('gives only the nearest warning when starting close, and none again after a re-route', () => {
    const done = new Set<string>();
    expect(dueAlerts(progress(4900, [['lock', 'Liepe', 5000]]), done).map((a) => a.text)).toEqual(['Liepe in 200 metres']);
    // re-planned from the boat: the lock is now 150 m from the start, still 15 km before the end
    const again = { ...progress(0, [['lock', 'Liepe', 150]], 15_150) };
    expect(dueAlerts(again, done)).toEqual([]);
  });
});

describe('announce', () => {
  it('vibrates, and speaks when voice is on', () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak });
    vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(t: string) { this.text = t; } });
    announce({ key: 'k', text: 'Lock in 1 kilometre' }, false);
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(speak).not.toHaveBeenCalled();
    announce({ key: 'k', text: 'Lock in 1 kilometre' }, true);
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({ text: 'Lock in 1 kilometre' }));
  });

  it('does nothing where the device cannot', () => {
    Object.defineProperty(navigator, 'vibrate', { value: undefined, configurable: true });
    vi.stubGlobal('speechSynthesis', undefined);
    expect(() => announce({ key: 'k', text: 'x' }, true)).not.toThrow();
  });
});
