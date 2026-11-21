import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LngLat } from '../graph/geo';
import type { Route } from '../routing/router';
import { REROUTE_MS, useNavigation, type NavigationOptions } from './useNavigation';

const route = (coordinates: LngLat[]): Route => ({
  coordinates, distance: 0, duration: 3600, locks: 0, unverified: 0, sea: 0, downstream: 0, upstream: 0, tooShallow: 0, shallowest: null,
  events: [], legs: [], start: { offset: 0 } as never, end: { offset: 0 } as never,
});
const line = route([[21, 52], [21.1, 52]]);
const pos = (lon: number, lat: number, time: number, speed: number | null = null) =>
  ({ coords: { longitude: lon, latitude: lat, accuracy: 10, speed, heading: speed ? 90 : null }, timestamp: time }) as GeolocationPosition;

function setup(over: Partial<NavigationOptions> = {}) {
  const opts: NavigationOptions = {
    route: line, stops: [], via: [], position: null,
    startWatching: vi.fn(() => Promise.resolve(pos(21, 52, 0))), onReroute: vi.fn(), ...over,
  };
  const hook = renderHook((o: NavigationOptions) => useNavigation(o), { initialProps: opts });
  return { ...hook, opts, set: (o: Partial<NavigationOptions>) => hook.rerender({ ...opts, ...o }) };
}

function wakeLock() {
  const sentinels: { release: ReturnType<typeof vi.fn> }[] = [];
  const request = vi.fn(() => {
    const s = { release: vi.fn(() => Promise.resolve()) };
    sentinels.push(s);
    return Promise.resolve(s);
  });
  Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
  return { request, sentinels };
}

afterEach(() => {
  localStorage.clear();
  Object.defineProperty(navigator, 'wakeLock', { value: undefined, configurable: true });
  Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
});

describe('useNavigation', () => {
  it('tracks progress and motion at each fix once started', async () => {
    const { result, set, opts } = setup();
    expect(result.current.active).toBe(false);
    set({ position: pos(21.05, 52, 0) });
    expect(result.current.progress).toBeNull(); // not navigating yet
    await act(async () => result.current.start());
    expect(opts.startWatching).toHaveBeenCalled();
    expect(result.current.active).toBe(true);
    expect(result.current.follow).toBe(true);
    set({ position: pos(21.05, 52, 1000, 3) });
    expect(result.current.progress!.along).toBeCloseTo(3425, -1);
    expect(result.current.motion).toEqual({ sog: 3, cog: 90 });
    act(() => result.current.setFollow(false));
    expect(result.current.follow).toBe(false);
    act(() => result.current.stop());
    expect(result.current.active).toBe(false);
    expect(result.current.progress).toBeNull();
  });

  it('does nothing without a route', async () => {
    const { result, set } = setup({ route: null });
    await act(async () => result.current.start());
    set({ route: null, position: pos(21, 52, 0) });
    expect(result.current.progress).toBeNull();
  });

  it('reports a GPS failure and stops', async () => {
    const { result } = setup({ startWatching: () => Promise.reject(new Error('denied')) });
    await act(async () => result.current.start());
    expect(result.current.error).toBe('denied');
    expect(result.current.active).toBe(false);
  });

  it('re-routes from the boat after a few fixes off the route, at most every 30 s, through waypoints ahead', async () => {
    const onReroute = vi.fn();
    const via: LngLat[] = [[21.01, 52], [21.08, 52]];
    const { result, set } = setup({ onReroute, via });
    await act(async () => result.current.start());
    set({ via, position: pos(21.03, 52, 0) }); // on the route, past the first waypoint
    for (let i = 1; i <= 3; i++) set({ via, position: pos(21.03, 52.01, i * 1000) });
    expect(onReroute).toHaveBeenCalledTimes(1);
    expect(onReroute).toHaveBeenCalledWith([21.03, 52.01], [[21.08, 52]]);
    expect(result.current.rerouting).toBe(true);
    set({ via, position: pos(21.03, 52.011, 10_000) });
    expect(onReroute).toHaveBeenCalledTimes(1);
    set({ via, position: pos(21.03, 52.012, 4000 + REROUTE_MS) });
    expect(onReroute).toHaveBeenCalledTimes(2);
    // the app drops the old route while the new one is planned: still re-routing
    set({ via, route: null, position: pos(21.03, 52.012, 4000 + REROUTE_MS) });
    expect(result.current.rerouting).toBe(true);
    // the new route from the boat clears the flag and starts afresh
    set({ via, route: route([[21.03, 52.012], [21.1, 52]]), position: pos(21.03, 52.012, 4000 + REROUTE_MS) });
    expect(result.current.rerouting).toBe(false);
  });

  it('warns ahead of events, records the track and keeps both across a reload', async () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, 'vibrate', { value: vibrate, configurable: true });
    const speak = vi.fn();
    vi.stubGlobal('speechSynthesis', { speak });
    vi.stubGlobal('SpeechSynthesisUtterance', class { text: string; constructor(t: string) { this.text = t; } });
    const { result, set } = setup();
    await act(async () => result.current.start());
    act(() => result.current.setVoice(true));
    expect(localStorage.getItem('interway.voice')).toBe('1');
    // 21.1 E is the end: 1 km before it is about 21.0853 E at 52 N
    for (let i = 0; i < 12; i++) set({ position: pos(21.081 + i * 0.0005, 52, i * 1000) });
    expect(speak).toHaveBeenCalledWith(expect.objectContaining({ text: 'Destination in 1 kilometre' }));
    expect(vibrate).toHaveBeenCalledTimes(1);
    expect(result.current.track.length).toBe(12);
    expect(JSON.parse(localStorage.getItem('interway.track')!)).toHaveLength(10); // saved every 10 points
    act(() => result.current.stop());
    expect(JSON.parse(localStorage.getItem('interway.track')!)).toHaveLength(12);
    set({ position: pos(21.09, 52, 20_000) }); // not navigating: not recorded
    const again = renderHook(() => useNavigation({ route: line, stops: [], via: [], position: null, startWatching: vi.fn(), onReroute: vi.fn() }));
    expect(again.result.current.track).toHaveLength(12);
    expect(again.result.current.voice).toBe(true);
    act(() => again.result.current.setVoice(false));
    expect(localStorage.getItem('interway.voice')).toBe('0');
    act(() => again.result.current.clearTrack());
    expect(again.result.current.track).toEqual([]);
    expect(localStorage.getItem('interway.track')).toBeNull();
    vi.unstubAllGlobals();
  });

  it('copes with blocked storage for the voice setting', () => {
    const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked'); });
    const setItem = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
    const { result } = setup();
    expect(result.current.voice).toBe(false);
    act(() => result.current.setVoice(true));
    expect(result.current.voice).toBe(true);
    get.mockRestore();
    setItem.mockRestore();
  });

  it('keeps the screen on while navigating and takes the lock again when the page comes back', async () => {
    const { request, sentinels } = wakeLock();
    const { result } = setup();
    await act(async () => result.current.start());
    expect(request).toHaveBeenCalledWith('screen');
    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(request).toHaveBeenCalledTimes(1);
    Object.defineProperty(document, 'visibilityState', { value: 'visible', configurable: true });
    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    expect(request).toHaveBeenCalledTimes(2);
    await act(async () => result.current.stop());
    expect(sentinels.at(-1)!.release).toHaveBeenCalled();
  });

  it('releases a lock granted after navigation stopped, and works when the lock is refused', async () => {
    let grant: (s: unknown) => void = () => {};
    const release = vi.fn(() => Promise.resolve());
    const request = vi.fn(() => new Promise((r) => { grant = r; }));
    Object.defineProperty(navigator, 'wakeLock', { value: { request }, configurable: true });
    const { result } = setup();
    await act(async () => result.current.start());
    act(() => result.current.stop());
    await act(async () => grant({ release }));
    expect(release).toHaveBeenCalled();
    Object.defineProperty(navigator, 'wakeLock', { value: { request: () => Promise.reject(new Error('no')) }, configurable: true });
    await act(async () => result.current.start());
    expect(result.current.active).toBe(true);
  });
});
