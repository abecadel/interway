import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LngLat } from './graph/geo';
import type { RoutingApi } from './routing/client';
import { defaultProfile, type Route } from './routing/router';

// MapView is replaced by buttons that simulate map clicks and expose the props it receives.
const mapProps = vi.hoisted(() => ({ current: null as null | Record<string, unknown> }));
vi.mock('./map/MapView', () => ({
  MapView: (props: { onMapClick: (p: LngLat) => void } & Record<string, unknown>) => {
    mapProps.current = props;
    return (
      <div>
        <button onClick={() => props.onMapClick([21.1, 52.1])}>map-click-1</button>
        <button onClick={() => props.onMapClick([21.2, 52.2])}>map-click-2</button>
      </div>
    );
  },
}));
vi.mock('./ui/search', () => ({ searchPlaces: vi.fn(async () => []) }));
const { default: App } = await import('./App');
import type { SiteTool } from './agent/siteTools';
import type { RouteBrief } from './ui/brief';

const route = (over: Partial<Route> = {}): Route => ({
  coordinates: [[21, 52], [21.5, 52.5]],
  distance: 123_456,
  duration: 3600 * 5,
  locks: 2,
  unverified: 0,
  sea: 0,
  seaNoDepth: 0,
  offshore: 0,
  noMotor: 0,
  limits: [],
  downstream: 0,
  upstream: 0,
  tooShallow: 0,
  shallowest: null,
  events: [],
  legs: [{ name: 'Narew', distance: 100_000 }, { name: '', distance: 23_456 }],
  start: { geom: 0, seg: 0, lat: 52, lon: 21, offset: 10, frac: 0 },
  end: { geom: 0, seg: 0, lat: 52.5, lon: 21.5, offset: 20, frac: 1 },
  ...over,
});

function fakeClient(over: Partial<RoutingApi> = {}) {
  return {
    load: vi.fn(async () => ({ manifest: { region: 'Test', version: 1, files: { graph: '', geom: '' }, names: [], attribution: '' }, nodes: 1234, edges: 5678, pois: [{ type: 'lock' as const, name: 'Śluza', lat: 52, lon: 21 }] })),
    route: vi.fn(async () => route()),
    alternatives: vi.fn(async (): Promise<Route[]> => []),
    network: vi.fn(async () => ({ type: 'FeatureCollection' as const, features: [] })),
    ...over,
  };
}

const flush = () => act(async () => { await new Promise((r) => setTimeout(r, 0)); });

function geolocation() {
  const watchers: { ok: PositionCallback; err: PositionErrorCallback }[] = [];
  const geo = { watchPosition: vi.fn((ok: PositionCallback, err: PositionErrorCallback) => watchers.push({ ok, err })) };
  Object.defineProperty(navigator, 'geolocation', { value: geo, configurable: true });
  const fix = (lon: number, lat: number) => ({ coords: { longitude: lon, latitude: lat, heading: null } }) as GeolocationPosition;
  return { geo, watchers, fix };
}

beforeEach(() => {
  localStorage.clear();
  history.replaceState(null, '', '/');
});
afterEach(() => {
  Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
});

describe('App', () => {
  it('loads data, routes between URL points and shows the summary', async () => {
    history.replaceState(null, '', '/?from=21.03,52.47&to=21.765,54.035');
    const client = fakeClient();
    render(<App client={client} />);
    expect(screen.getByText('Loading waterway data…')).toBeTruthy();
    await flush();
    expect(screen.getByText('Test: 1,234 nodes, 5,678 edges')).toBeTruthy();
    expect(client.route).toHaveBeenCalledWith([21.03, 52.47], [21.765, 54.035], defaultProfile, []);
    expect(screen.getByText('5 h 0 min')).toBeTruthy();
    expect(screen.getByText('123 km (66.7 NM) · 2 locks · at 10 km/h')).toBeTruthy();
    // legs and stops are behind Steps
    expect(screen.queryByText('unnamed waterway')).toBeNull();
    fireEvent.click(screen.getByText('Steps'));
    expect(screen.getByText('unnamed waterway')).toBeTruthy();
    expect(screen.queryByText(/snapped/)).toBeNull();
    expect(screen.queryByText(/unverified/)).toBeNull();
    expect(mapProps.current!.pois).toEqual([{ type: 'lock', name: 'Śluza', lat: 52, lon: 21 }]);
    // the itinerary lists the lock at the start of the route; picking it focuses the map there
    expect(screen.getByText('km 0.0')).toBeTruthy();
    fireEvent.click(screen.getByText('Śluza'));
    expect(mapProps.current!.focus).toEqual([21, 52]);
    expect(location.search).toBe('?from=21.03000,52.47000&to=21.76500,54.03500');
  });

  it('shows loading errors, route errors and snapping warnings', async () => {
    const failing = fakeClient({ load: vi.fn(async () => { throw new Error('No waterway data found'); }) });
    const { unmount } = render(<App client={failing} />);
    await flush();
    expect(screen.getByText('No waterway data found')).toBeTruthy();
    unmount();

    history.replaceState(null, '', '/?from=1,2&to=3,4');
    const client = fakeClient({ route: vi.fn(async () => { throw new Error('No navigable route'); }) });
    const r = render(<App client={client} />);
    await flush();
    expect(screen.getByText('No navigable route')).toBeTruthy();
    r.unmount();

    const far = fakeClient({ route: vi.fn(async () => route({ start: { ...route().start, offset: 1500 }, unverified: 2500, sea: 18520, seaNoDepth: 9260, tooShallow: 4000, shallowest: { draft: 2.3, at: 40_000 } })) });
    render(<App client={far} />);
    await flush();
    expect(screen.getByText(/snapped to the nearest navigable water \(1\.5 km/)).toBeTruthy();
    expect(screen.getByText(/Includes 2\.5 km on unverified connections/)).toBeTruthy();
    expect(screen.getByText(/10\.0 NM on open sea/).textContent).toContain('Shallowest stretch allows about 2.3 m draft (km 40). Depth unknown for 5.0 NM');
  });

  it('shows the river current and the time of the way back', async () => {
    history.replaceState(null, '', '/?from=1,2&to=3,4');
    const river = route({ downstream: 80_000, upstream: 20_000 });
    const back = vi.fn().mockResolvedValueOnce(river).mockResolvedValueOnce(route({ duration: 8 * 3600 }));
    const r = render(<App client={fakeClient({ route: back })} />);
    await flush();
    await flush();
    expect(back).toHaveBeenLastCalledWith([3, 4], [1, 2], expect.anything(), []);
    expect(screen.getByText(/With the current 80(\.0)? km · against it 20(\.0)? km \(0\.5 m\/s\) · return about 8 h/)).toBeTruthy();
    r.unmount();

    // the way back fails: the current is still shown, without a return time
    const failing = vi.fn().mockResolvedValueOnce(river).mockRejectedValueOnce(new Error('no way back'));
    const f = render(<App client={fakeClient({ route: failing })} />);
    await flush();
    await flush();
    expect(screen.getByText(/With the current/).textContent).not.toContain('return about');
    f.unmount();

    // leaving before the way back is known drops its result
    let resolveBack: (r: Route) => void = () => {};
    const slow = vi.fn().mockResolvedValueOnce(river).mockReturnValueOnce(new Promise<Route>((res) => { resolveBack = res; }));
    const u = render(<App client={fakeClient({ route: slow })} />);
    await flush();
    u.unmount();
    resolveBack(route());
    await flush();
  });

  it('ignores invalid URL points and a corrupt stored profile', async () => {
    history.replaceState(null, '', '/?from=1,2,3&to=a,b');
    localStorage.setItem('interway.profile', '{oops');
    const client = fakeClient();
    render(<App client={client} />);
    await flush();
    expect(client.route).not.toHaveBeenCalled();
    expect(location.search).toBe('');
  });

  it('picks points by clicking the map and swaps them', async () => {
    const client = fakeClient();
    render(<App client={client} />);
    await flush();
    fireEvent.click(screen.getByText('map-click-1')); // exploring: a tap on the map plans nothing
    expect(mapProps.current!.start).toBeNull();
    fireEvent.click(screen.getByLabelText('Directions'));
    fireEvent.click(screen.getByText('map-click-1')); // no point yet -> A
    fireEvent.click(screen.getByText('map-click-2')); // A set -> B
    await flush();
    expect(client.route).toHaveBeenLastCalledWith([21.1, 52.1], [21.2, 52.2], defaultProfile, []);
    fireEvent.click(screen.getByText('map-click-1')); // both set, not picking -> ignored
    expect(client.route).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getAllByText('Pick on map')[1]); // pick B explicitly
    expect(screen.getByText('Click on the map…')).toBeTruthy();
    fireEvent.click(screen.getByText('Click on the map…')); // toggle off
    fireEvent.click(screen.getAllByText('Pick on map')[1]);
    fireEvent.click(screen.getByText('map-click-1'));
    await flush();
    expect(client.route).toHaveBeenLastCalledWith([21.1, 52.1], [21.1, 52.1], defaultProfile, []);

    fireEvent.click(screen.getAllByText('Pick on map')[0]);
    fireEvent.click(screen.getByText('Click on the map…'));
    fireEvent.click(screen.getAllByText('Pick on map')[0]);
    fireEvent.click(screen.getByText('map-click-2'));
    await flush();
    expect(client.route).toHaveBeenLastCalledWith([21.2, 52.2], [21.1, 52.1], defaultProfile, []);

    fireEvent.click(screen.getByTitle('Swap'));
    await flush();
    expect(client.route).toHaveBeenLastCalledWith([21.1, 52.1], [21.2, 52.2], defaultProfile, []);

    fireEvent.click(screen.getAllByTitle('Clear')[1]); // clear B -> next click sets B
    fireEvent.click(screen.getByText('map-click-2'));
    await flush();
    expect(client.route).toHaveBeenLastCalledWith([21.1, 52.1], [21.2, 52.2], defaultProfile, []);
  });

  it('drops results of outdated requests', async () => {
    const pending: { resolve: (r: Route) => void; reject: (e: Error) => void }[] = [];
    const client = fakeClient({ route: vi.fn(() => new Promise<Route>((resolve, reject) => pending.push({ resolve, reject }))) });
    history.replaceState(null, '', '/?from=1,2&to=3,4');
    render(<App client={client} />);
    await flush();
    expect(screen.getByText('Calculating route…')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Swap')); // new request, the first one is now stale
    await flush();
    await act(async () => {
      pending[0].resolve(route({ distance: 999_000 }));
      pending[1].reject(new Error('second failed'));
    });
    expect(screen.queryByText(/999 km/)).toBeNull();
    expect(screen.getByText('second failed')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Swap')); // request 3
    await flush();
    fireEvent.click(screen.getByTitle('Swap')); // request 4 makes request 3 stale
    await flush();
    await act(async () => pending[2].reject(new Error('stale error')));
    await act(async () => pending[3].resolve(route()));
    expect(screen.queryByText('stale error')).toBeNull();
    expect(screen.getByText('5 h 0 min')).toBeTruthy();
  });

  it('uses GPS for A and B and keeps watching', async () => {
    const { geo, watchers, fix } = geolocation();
    const client = fakeClient();
    render(<App client={client} />);
    await flush();
    fireEvent.click(screen.getByLabelText('Directions'));
    fireEvent.click(screen.getAllByText('My position')[0]);
    await act(async () => watchers[0].ok(fix(21.5, 52.5)));
    expect(screen.getAllByPlaceholderText('My position')).toHaveLength(1);
    await act(async () => watchers[0].ok(fix(21.6, 52.6))); // later fixes only move the marker
    expect(mapProps.current!.position).toEqual(fix(21.6, 52.6));
    fireEvent.click(screen.getAllByText('My position')[1]); // already watching: reuse the last fix
    await flush();
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(client.route).toHaveBeenLastCalledWith([21.5, 52.5], [21.6, 52.6], defaultProfile, []);
    await act(async () => watchers[0].err({ message: 'signal lost' } as GeolocationPositionError));
    expect(screen.getByText('GPS: signal lost')).toBeTruthy();
    await act(async () => watchers[0].ok(fix(21.7, 52.7)));
    expect(screen.queryByText(/GPS:/)).toBeNull();
  });

  it('navigates: follows the boat, shows progress, re-routes when off the route and stops', async () => {
    const { geo, watchers } = geolocation();
    const at = (lon: number, lat: number, time: number, speed: number | null = null) =>
      ({ coords: { longitude: lon, latitude: lat, accuracy: 10, speed, heading: speed ? 45 : null }, timestamp: time }) as GeolocationPosition;
    history.replaceState(null, '', '/?from=21,52&to=21.5,52.5');
    const client = fakeClient();
    render(<App client={client} />);
    await flush();
    expect(mapProps.current!.follow).toBe(false);
    expect(mapProps.current!.fitRoute).toBe(true);
    const planned = location.search;
    fireEvent.click(screen.getByText('Start'));
    expect(geo.watchPosition).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Waiting for GPS…')).toBeTruthy();
    await act(async () => watchers[0].ok(at(21.1, 52.1, 1000, 2)));
    expect(screen.getByText('Destination', { exact: false })).toBeTruthy();
    expect(mapProps.current!.follow).toBe(true);
    expect(mapProps.current!.course).toBe(45);
    expect(mapProps.current!.fitRoute).toBe(false);
    act(() => (mapProps.current!.onUserMove as () => void)());
    expect(mapProps.current!.follow).toBe(false);
    fireEvent.click(screen.getByText('Recenter'));
    expect(mapProps.current!.follow).toBe(true);
    const drawn = () => act(() => (mapProps.current!.onRouteDrawn as (r: unknown) => void)(mapProps.current!.route));
    drawn();
    // three fixes well off the line: plan again from the boat; the link keeps the planned route
    for (let i = 1; i <= 3; i++) await act(async () => watchers[0].ok(at(21.4, 52.1, 1000 + i * 1000)));
    await flush();
    // the new route has arrived, but the map has not drawn it yet: the note stays up until it has
    expect(screen.getByText('Off the route: re-routing from here…')).toBeTruthy();
    drawn();
    expect(screen.queryByText('Off the route: re-routing from here…')).toBeNull();
    expect(client.route).toHaveBeenLastCalledWith([21.4, 52.1], [21.5, 52.5], defaultProfile, []);
    expect(location.search).toBe(planned);
    expect(mapProps.current!.start).toEqual([21.4, 52.1]);
    expect(mapProps.current!.course).toBeNull();
    fireEvent.click(screen.getByLabelText('Stop'));
    expect(screen.queryByLabelText('Navigation')).toBeNull();
    expect(location.search).toContain('from=21.40000,52.10000');
  });

  it('rings the structures that limit the boat and lets the map open popups once A and B are set', async () => {
    history.replaceState(null, '', '/?from=21,52&to=21.5,52.5');
    const lock = { type: 'lock' as const, name: 'Narrow', lat: 52, lon: 21, maxwidth: 5.3, maxlength: 38 };
    const base = fakeClient();
    const client = fakeClient({ load: vi.fn(async () => ({ ...(await base.load('')), pois: [lock] })) });
    render(<App client={client} />);
    await flush();
    expect(mapProps.current!.limits).toEqual([[21, 52], [21, 52]]);
    expect(mapProps.current!.picking).toBe(false);
    fireEvent.click(screen.getByText('Add waypoint'));
    expect(mapProps.current!.picking).toBe(true);
  });

  it('offers the last track for export and clearing', async () => {
    localStorage.setItem('interway.track', JSON.stringify([{ lon: 1, lat: 2, time: 0 }, { lon: 1, lat: 2.001, time: 1000 }]));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();
    render(<App client={fakeClient()} />);
    expect(screen.getByText('Track: 2 points', { exact: false })).toBeTruthy();
    fireEvent.click(screen.getByText('Export GPX'));
    expect(click).toHaveBeenCalled();
    fireEvent.click(screen.getByText('Clear'));
    expect(screen.queryByText(/Track:/)).toBeNull();
    click.mockRestore();
  });

  it('says why navigation could not start', async () => {
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    history.replaceState(null, '', '/?from=21,52&to=21.5,52.5');
    render(<App client={fakeClient()} />);
    await flush();
    fireEvent.click(screen.getByText('Start'));
    await flush();
    expect(screen.getByText('Navigation: Geolocation not supported')).toBeTruthy();
    expect(screen.queryByLabelText('Navigation')).toBeNull();
  });

  it('reports GPS errors and missing GPS', async () => {
    const { watchers } = geolocation();
    const { unmount } = render(<App client={fakeClient()} />);
    fireEvent.click(screen.getByLabelText('Directions'));
    fireEvent.click(screen.getAllByText('My position')[0]);
    await act(async () => watchers[0].err({ message: 'denied' } as GeolocationPositionError));
    expect(screen.getByText('GPS: denied')).toBeTruthy();
    unmount();

    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    render(<App client={fakeClient()} />);
    fireEvent.click(screen.getByLabelText('Show my position')); // the round button: same GPS, same error
    await flush();
    expect(screen.getByText('GPS: Geolocation not supported')).toBeTruthy();
  });

  it('reads waypoints and the vessel from the URL, adds and removes waypoints', async () => {
    // a profile saved before the 0.5 m default carries the old 3 m beam as if chosen: it becomes the new default
    localStorage.setItem('interway.profile', JSON.stringify({ ...defaultProfile, draft: 1.8, beam: 3 }));
    history.replaceState(null, '', '/?from=1,2&to=3,4&via=1.5,2.5&draft=2.4&avoidLocks=1');
    const client = fakeClient();
    render(<App client={client} />);
    await flush();
    const profile = { ...defaultProfile, draft: 2.4, avoidLocks: true }; // the URL wins over stored settings
    expect(client.route).toHaveBeenLastCalledWith([1, 2], [3, 4], profile, [[1.5, 2.5]]);
    expect(mapProps.current!.via).toEqual([[1.5, 2.5]]);
    fireEvent.click(screen.getByText('Add waypoint'));
    fireEvent.click(screen.getByText('Click the map to add a waypoint…'));
    fireEvent.click(screen.getByText('Add waypoint'));
    fireEvent.click(screen.getByText('map-click-1'));
    await flush();
    expect(client.route).toHaveBeenLastCalledWith([1, 2], [3, 4], profile, [[1.5, 2.5], [21.1, 52.1]]);
    expect(location.search).toBe('?from=1.00000,2.00000&to=3.00000,4.00000&via=1.50000,2.50000;21.10000,52.10000&draft=2.4&avoidLocks=1');
    fireEvent.click(screen.getAllByTitle('Remove waypoint')[0]);
    await flush();
    expect(client.route).toHaveBeenLastCalledWith([1, 2], [3, 4], profile, [[21.1, 52.1]]);
  });

  it('edits and persists the vessel profile', async () => {
    // a profile saved before the 0.5 m default carries the old 3 m beam as if chosen: it becomes the new default
    localStorage.setItem('interway.profile', JSON.stringify({ ...defaultProfile, draft: 1.8, beam: 3 }));
    history.replaceState(null, '', '/?from=1,2'); // a start only: not a route link, the saved boat applies
    const first = render(<App client={fakeClient()} />);
    await flush();
    fireEvent.click(screen.getByText('Custom…'));
    expect((screen.getByLabelText('Draft (m)') as HTMLInputElement).value).toBe('1.8');
    expect((screen.getByLabelText('Beam (m)') as HTMLInputElement).value).toBe('0.5');
    first.unmount();
    // a route link is the whole route: the boat saved in this browser does not change it, nor is it overwritten
    history.replaceState(null, '', '/?from=1,2&to=3,4');
    const client = fakeClient();
    render(<App client={client} />);
    await flush();
    expect(client.route).toHaveBeenLastCalledWith([1, 2], [3, 4], defaultProfile, []);
    expect(JSON.parse(localStorage.getItem('interway.profile')!)).toMatchObject({ draft: 1.8 });
    // a boat type sets speed and size; Custom opens every field
    fireEvent.click(screen.getByText('Narrowboat'));
    await flush();
    expect(client.route).toHaveBeenLastCalledWith([1, 2], [3, 4], expect.objectContaining({ beam: 2.08, length: 18, speedKmh: 6 }), []);
    expect(screen.getByText('Narrowboat').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByText('Small boat'));
    await flush();
    expect(screen.queryByLabelText('Air draft (m)')).toBeNull();
    fireEvent.click(screen.getByText('Custom…'));
    fireEvent.change(screen.getByLabelText('Draft (m)'), { target: { value: '1.8' } });
    fireEvent.change(screen.getByLabelText('Air draft (m)'), { target: { value: '4.5' } });
    fireEvent.click(screen.getByLabelText('Avoid locks'));
    fireEvent.click(screen.getByLabelText('Avoid open sea'));
    fireEvent.click(screen.getByLabelText('Stay near the coast (harbour to harbour)'));
    fireEvent.change(screen.getByLabelText('Departure date'), { target: { value: '2027-05-01' } });
    await flush();
    const expected = { ...defaultProfile, draft: 1.8, airDraft: 4.5, avoidLocks: true, avoidSea: true, coastal: true, departure: '2027-05-01' };
    expect(client.route).toHaveBeenLastCalledWith([1, 2], [3, 4], expected, []);
    // what differs from the defaults, or was chosen (the boat type's sizes), is saved; the date is not
    expect(JSON.parse(localStorage.getItem('interway.profile')!)).toEqual(
      { draft: 1.8, airDraft: 4.5, beam: expected.beam, length: expected.length, speedKmh: expected.speedKmh, avoidLocks: true, avoidSea: true, coastal: true });
    // the link keeps the values given, even those equal to the default
    expect(location.search).toContain(`len=${expected.length}`);
  });

  it('toggles layers and loads the debug network once', async () => {
    const client = fakeClient();
    render(<App client={client} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
    fireEvent.click(screen.getByLabelText('OpenSeaMap seamarks'));
    expect(mapProps.current!.showSeamarks).toBe(false);
    fireEvent.click(screen.getByLabelText('Routable network (debug)'));
    await flush();
    expect(mapProps.current!.network).toEqual({ type: 'FeatureCollection', features: [] });
    fireEvent.click(screen.getByLabelText('Routable network (debug)'));
    expect(mapProps.current!.network).toBeNull();
    fireEvent.click(screen.getByLabelText('Routable network (debug)'));
    await flush();
    expect(client.network).toHaveBeenCalledTimes(1);
  });

  it('explores: search, tap or drop a place, save it, list a category, and plan from a place', async () => {
    const { watchers, fix } = geolocation();
    localStorage.setItem('interway.sheet', 'peek'); // a folded sheet opens for a place
    const base = fakeClient();
    const client = fakeClient({ load: vi.fn(async () => ({ ...(await base.load('')), pois: [{ type: 'lock' as const, name: 'Śluza', lat: 52, lon: 21 }, { type: 'lock' as const, name: '', lat: 52.001, lon: 21 }] })) });
    render(<App client={client} />);
    await flush();
    const props = () => mapProps.current as Record<string, (...a: unknown[]) => void> & Record<string, unknown>;
    // "/" focuses the search box; a search result opens its place sheet
    fireEvent.keyDown(window, { key: '/' });
    expect(document.activeElement).toBe(screen.getByLabelText('Search'));
    fireEvent.change(screen.getByLabelText('Search'), { target: { value: 'Śl' } });
    fireEvent.click(screen.getByText('Śluza · lock'));
    expect(screen.getByRole('heading', { name: 'Śluza' })).toBeTruthy();
    expect(screen.getByText('Lock')).toBeTruthy();
    expect(props().place).toEqual([21, 52]);
    expect(props().focus).toEqual([21, 52]);
    fireEvent.click(screen.getByText('Save'));
    expect(JSON.parse(localStorage.getItem('interway.saved')!)).toEqual([{ label: 'Śluza', position: [21, 52] }]);
    expect(JSON.parse(localStorage.getItem('interway.recent')!)).toHaveLength(1);
    fireEvent.keyDown(screen.getByLabelText('Search'), { key: '/' }); // typing: ignored
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByLabelText('Place')).toBeNull();
    expect(localStorage.getItem('interway.sheet')).toBe('half');
    fireEvent.keyDown(window, { key: 'Escape' }); // nothing open: nothing to do
    // a saved place comes back from the empty search box
    fireEvent.focus(screen.getByLabelText('Search'));
    fireEvent.click(screen.getByText('Śluza', { selector: 'button' }));
    expect(screen.getByRole('heading', { name: 'Śluza' })).toBeTruthy();
    expect(screen.queryByText('Lock')).toBeNull();
    // a tapped map symbol, and a dropped pin; a tap on the map closes it
    act(() => props().onFeatureClick({ type: 'bridge', name: '', detail: 'clearance 3.2 m', position: [5, 5] }));
    expect(screen.getByRole('heading', { name: 'Bridge' })).toBeTruthy();
    act(() => props().onFeatureClick({ type: 'lock', name: 'Route lock', detail: '', position: [6, 6], at: 2500 }));
    expect(screen.getByText('km 2.5 on the route')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close place'));
    expect(screen.queryByLabelText('Place')).toBeNull();
    act(() => props().onLongPress([7, 8]));
    expect(screen.getByRole('heading', { name: 'Dropped pin' })).toBeTruthy();
    fireEvent.click(screen.getByText('map-click-1'));
    expect(screen.queryByLabelText('Place')).toBeNull();
    // a category lists the nearest places to the map centre; picking one opens it
    act(() => props().onViewChange([21, 52]));
    fireEvent.click(screen.getByText('Locks'));
    expect(screen.getByText('Locks nearby')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close list'));
    expect(screen.queryByText('Locks nearby')).toBeNull();
    fireEvent.click(screen.getByText('Locks'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Locks nearby')).toBeNull();
    fireEvent.click(screen.getByText('Locks'));
    fireEvent.click(screen.getByText('Locks')); // a second tap closes the list
    expect(screen.queryByText('Locks nearby')).toBeNull();
    fireEvent.click(screen.getByText('Locks'));
    fireEvent.click(screen.getByText('Lock', { selector: '.name' })); // the nameless one
    expect(screen.getByRole('heading', { name: 'Lock' })).toBeTruthy();
    fireEvent.click(screen.getByText('Locks'));
    fireEvent.click(screen.getByText('Śluza'));
    expect(screen.getByRole('heading', { name: 'Śluza' })).toBeTruthy();
    // the layers card closes first on Esc
    fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByText('Map type')).toBeNull();
    fireEvent.keyDown(window, { key: 'x' });
    // Start here, then Directions to another place: a route between them
    fireEvent.click(screen.getByText('Start here'));
    expect(props().start).toEqual([21, 52]);
    act(() => props().onLongPress([7, 8]));
    fireEvent.click(screen.getByText('Directions', { selector: 'button' }));
    await flush();
    expect(client.route).toHaveBeenLastCalledWith([21, 52], [7, 8], defaultProfile, []);
    // closing directions clears the route and goes back to exploring
    fireEvent.click(screen.getByLabelText('Close directions'));
    expect(props().start).toBeNull();
    expect(screen.getByLabelText('Search')).toBeTruthy();
    // with a GPS fix, Directions starts from the boat; the round button centres the map on it
    fireEvent.click(screen.getByLabelText('Show my position'));
    await act(async () => watchers[0].ok(fix(20, 50)));
    expect(props().focus).toEqual([20, 50]);
    act(() => props().onLongPress([7, 8]));
    fireEvent.click(screen.getByText('Directions', { selector: 'button' }));
    expect(props().start).toEqual([20, 50]);
    expect(screen.getAllByPlaceholderText('My position')).toHaveLength(1);
    // the vessel form opens from Custom
    fireEvent.click(screen.getByText('Custom…'));
    expect(screen.getByLabelText('Air draft (m)')).toBeTruthy();
  });

  it('shows what OSM knows about a tapped marina', async () => {
    const base = fakeClient();
    const marina = { type: 'marina' as const, name: 'Port Hercule', lat: 43.735, lon: 7.425, vhf: '12', website: 'https://www.ports-monaco.com' };
    render(<App client={fakeClient({ load: vi.fn(async () => ({ ...(await base.load('')), pois: [marina] })) })} />);
    await flush();
    const props = () => mapProps.current as Record<string, (...a: unknown[]) => void>;
    act(() => props().onFeatureClick({ type: 'marina', name: 'Port Hercule', detail: '', position: [7.425, 43.735] }));
    expect(screen.getByText('channel 12')).toBeTruthy();
    expect((screen.getByText('ports-monaco.com') as HTMLAnchorElement).href).toBe('https://www.ports-monaco.com/');
  });

  it('places a tapped lock on the route', async () => {
    history.replaceState(null, '', '/?from=21,52&to=21.5,52.5');
    render(<App client={fakeClient()} />);
    await flush();
    const props = () => mapProps.current as Record<string, (...a: unknown[]) => void>;
    act(() => props().onFeatureClick({ type: 'lock', name: 'Śluza', detail: '', position: [21, 52] }));
    expect(screen.getByText('km 0.0 on the route')).toBeTruthy();
    act(() => props().onFeatureClick({ type: 'lock', name: 'Other', detail: '', position: [21, 60] }));
    expect(screen.queryByText(/on the route/)).toBeNull();
  });

  it('offers other routes and lets the user choose one, in the summary or on the map', async () => {
    history.replaceState(null, '', '/?from=1,2&to=3,4');
    const other = route({ duration: 6 * 3600, distance: 140_000, coordinates: [[1, 2], [2, 3], [3, 4]] });
    const client = fakeClient({ alternatives: vi.fn(async () => [other]) });
    const { unmount } = render(<App client={client} />);
    await flush();
    await flush();
    expect(client.alternatives).toHaveBeenCalledWith([1, 2], [3, 4], defaultProfile);
    expect(screen.getByText('5 h 0 min · 123 km · best').getAttribute('aria-pressed')).toBe('true');
    expect(mapProps.current!.alternatives).toEqual([{ index: 1, coordinates: other.coordinates, label: '6 h 0 min' }]);
    fireEvent.click(screen.getByText('6 h 0 min · 140 km'));
    expect(screen.getByText('6 h 0 min', { selector: '.big' })).toBeTruthy();
    expect(mapProps.current!.route).toBe(other);
    // the best one is now the grey line: a tap on it takes it back
    act(() => (mapProps.current!.onAlternative as (i: number) => void)(0));
    expect(mapProps.current!.route).not.toBe(other);
    unmount();

    // waypoints fix the way: no alternatives asked; a failed or late answer changes nothing
    history.replaceState(null, '', '/?from=1,2&to=3,4&via=1.5,2.5');
    const quiet = fakeClient({ alternatives: vi.fn(async () => { throw new Error('busy'); }) });
    const q = render(<App client={quiet} />);
    await flush();
    expect(quiet.alternatives).not.toHaveBeenCalled();
    q.unmount();
    history.replaceState(null, '', '/?from=1,2&to=3,4');
    const failing = fakeClient({ alternatives: vi.fn(async () => { throw new Error('busy'); }) });
    const f = render(<App client={failing} />);
    await flush();
    await flush();
    expect(screen.queryByText(/· best/)).toBeNull();
    f.unmount();
    let late: (r: Route[]) => void = () => {};
    const slow = fakeClient({ alternatives: vi.fn(() => new Promise<Route[]>((res) => { late = res; })) });
    const l = render(<App client={slow} />);
    await flush();
    l.unmount();
    late([other]);
    await flush();
  });

  it('folds the desktop side panel and remembers it', async () => {
    history.replaceState(null, '', '/?from=1,2&to=3,4');
    const { unmount } = render(<App client={fakeClient()} />);
    await flush();
    fireEvent.click(screen.getByLabelText('Collapse side panel'));
    expect(screen.queryByText('5 h 0 min')).toBeNull();
    expect(localStorage.getItem('interway.sheet')).toBe('peek');
    unmount();
    render(<App client={fakeClient()} />);
    await flush();
    fireEvent.click(screen.getByLabelText('Expand side panel'));
    expect(screen.getByText('5 h 0 min')).toBeTruthy();
    expect(localStorage.getItem('interway.sheet')).toBe('half');
  });

  it('on phones: a bottom sheet under a top bar, a folded directions card, and the sheet remembered', async () => {
    const mm = window.matchMedia;
    window.matchMedia = ((q: string) => ({ matches: q === '(max-width: 700px)', addEventListener() {}, removeEventListener() {} })) as never;
    // the sheet's top stops below the top bar, measured as it changes
    const observed: (() => void)[] = [];
    const disconnect = vi.fn();
    vi.stubGlobal('ResizeObserver', class { constructor(cb: () => void) { observed.push(cb); } observe() {} disconnect = disconnect; });
    try {
      history.replaceState(null, '', '/?from=1,2&to=3,4');
      const { unmount } = render(<App client={fakeClient()} />);
      await flush();
      const handle = screen.getByRole('button', { name: '5 h 0 min · 123 km' });
      expect(handle.getAttribute('aria-expanded')).toBe('true');
      fireEvent.click(handle);
      expect(handle.getAttribute('aria-expanded')).toBe('false');
      expect(handle.textContent).toBe('5 h 0 min · 123 km');
      expect(localStorage.getItem('interway.sheet')).toBe('peek');
      fireEvent.click(handle);
      act(() => observed.at(-1)!());
      expect(document.querySelector<HTMLElement>('.app')!.style.getPropertyValue('--topbar-h')).toBe('0px');
      // with a route the directions card is one line; tapped, it opens for editing
      expect(screen.queryByText('Pick on map')).toBeNull();
      fireEvent.click(screen.getByLabelText('Edit route'));
      expect(screen.getAllByText('Pick on map')).toHaveLength(2);
      fireEvent.click(screen.getByText('Steps')); // steps open the sheet all the way
      expect(localStorage.getItem('interway.sheet')).toBe('full');
      unmount();

      // storage blocked: the sheet starts half open and still moves
      const realGet = Storage.prototype.getItem, realSet = Storage.prototype.setItem;
      const blocked = (k: string) => { if (k === 'interway.sheet') throw new Error('blocked'); };
      const get = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(function (this: Storage, k) { blocked(k); return realGet.call(this, k); });
      const set = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (this: Storage, k, v) { blocked(k); realSet.call(this, k, v); });
      try {
        history.replaceState(null, '', '/');
        render(<App client={fakeClient()} />);
        await flush();
        const explore = screen.getByRole('button', { name: 'Explore' });
        expect(explore.getAttribute('aria-expanded')).toBe('true');
        fireEvent.click(explore);
        expect(explore.getAttribute('aria-expanded')).toBe('false');
      } finally {
        get.mockRestore();
        set.mockRestore();
      }
    } finally {
      window.matchMedia = mm;
      vi.unstubAllGlobals();
    }
    expect(disconnect).toHaveBeenCalled();
  });

  it('switches the map to night colours and offers to install the app', async () => {
    render(<App client={fakeClient()} />);
    await flush();
    expect(mapProps.current!.night).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
    fireEvent.click(screen.getByRole('button', { name: 'Night' }));
    expect(mapProps.current!.night).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('night');
    fireEvent.click(screen.getByRole('button', { name: 'Auto' }));
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);

    expect(screen.queryByText('Install app')).toBeNull();
    const offer = Object.assign(new Event('beforeinstallprompt', { cancelable: true }), {
      prompt: vi.fn(async () => {}), userChoice: Promise.resolve({ outcome: 'dismissed' }),
    });
    act(() => { window.dispatchEvent(offer); });
    await act(async () => { fireEvent.click(screen.getByText('Install app')); });
    expect(offer.prompt).toHaveBeenCalled();
    expect(screen.queryByText('Install app')).toBeNull();
  });

  it('reports network loading errors', async () => {
    const client = fakeClient({ network: vi.fn(async () => { throw new Error('network failed'); }) });
    render(<App client={client} />);
    await flush();
    fireEvent.click(screen.getByRole('button', { name: 'Layers' }));
    fireEvent.click(screen.getByLabelText('Routable network (debug)'));
    await flush();
    expect(screen.getByText('network failed')).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Close layers'));
    expect(screen.queryByLabelText('Routable network (debug)')).toBeNull();
  });

  it('exports the route as GPX', async () => {
    history.replaceState(null, '', '/?from=1,2&to=3,4');
    const createObjectURL = vi.fn(() => 'blob:x');
    const revokeObjectURL = vi.fn();
    Object.assign(URL, { createObjectURL, revokeObjectURL });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<App client={fakeClient()} />);
    await flush();
    fireEvent.click(screen.getByText('GPX'));
    const blob = (createObjectURL.mock.calls[0] as unknown[])[0] as Blob;
    expect(blob.type).toBe('application/gpx+xml');
    expect(await blob.text()).toContain('2.0000°N 1.0000°E → 4.0000°N 3.0000°E');
    expect(click).toHaveBeenCalled();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:x');

    fireEvent.click(screen.getByText('Brief .md'));
    const md = (createObjectURL.mock.calls[1] as unknown[])[0] as Blob;
    expect(md.type).toBe('text/markdown');
    expect(await md.text()).toContain('Open or edit: http://localhost:3000/?from=1.00000,2.00000&to=3.00000,4.00000');
    fireEvent.click(screen.getByText('JSON'));
    const json = JSON.parse(await ((createObjectURL.mock.calls[2] as unknown[])[0] as Blob).text());
    expect(json.title).toBe('2.0000°N 1.0000°E → 4.0000°N 3.0000°E');
  });

  it('lets AI agents plan and edit routes through WebMCP site tools', async () => {
    const tools: Record<string, SiteTool> = {};
    Object.defineProperty(document, 'modelContext', {
      value: { registerTool: (t: SiteTool) => { tools[t.name] = t; } }, configurable: true,
    });
    const client = fakeClient();
    render(<App client={client} />);
    await flush();
    expect(Object.keys(tools)).toContain('plan_route');
    await expect(tools.get_route_brief.execute({})).rejects.toThrow('call plan_route first');

    let out: RouteBrief | undefined;
    await act(async () => {
      out = await tools.plan_route.execute({ from: { lon: 1, lat: 2 }, to: { lon: 3, lat: 4 }, via: [{ lon: 2, lat: 3 }], vessel: { draft: 1.5 } }) as RouteBrief;
    });
    const profile = { ...defaultProfile, draft: 1.5 };
    expect(client.route).toHaveBeenCalledWith([1, 2], [3, 4], profile, [[2, 3]]);
    expect(out!.totals.km).toBe(123.5);
    expect(out!.link).toBe('http://localhost:3000/?from=1.00000,2.00000&to=3.00000,4.00000&via=2.00000,3.00000&draft=1.5');
    await flush();
    expect(location.search).toBe('?from=1.00000,2.00000&to=3.00000,4.00000&via=2.00000,3.00000&draft=1.5');
    const now = await tools.get_route_brief.execute({}) as RouteBrief;
    expect(now.link).toBe(out!.link);

    await act(async () => { await tools.set_vessel.execute({ airDraft: 4 }); });
    await act(async () => { await tools.add_waypoint.execute({ point: { lon: 2.5, lat: 3.5 } }); });
    await flush();
    expect(client.route).toHaveBeenLastCalledWith([1, 2], [3, 4], { ...profile, airDraft: 4 }, [[2, 3], [2.5, 3.5]]);
    // values an agent gives stay in the link and are not called defaults, even when equal to the default
    await act(async () => { await tools.set_vessel.execute({ airDraft: 4, length: defaultProfile.length }); });
    await flush();
    const given = await tools.get_route_brief.execute({}) as RouteBrief;
    expect(given.link).toContain(`len=${defaultProfile.length}`);
    expect(given.vessel.defaults).toEqual(['beam']);
    await act(async () => { await tools.set_vessel.execute({ length: defaultProfile.length }); }); // already given
    expect(((await tools.get_route_brief.execute({})) as RouteBrief).link).toBe(given.link);
    // straight after a change the brief waits for the recomputed route, and a route that fails says why
    let fresh: Promise<unknown> | undefined;
    await act(async () => {
      await tools.set_vessel.execute({ draft: 1.6 });
      fresh = tools.get_route_brief.execute({}); // asked before the page has even rendered the change
    });
    await flush();
    await flush();
    expect(((await fresh) as RouteBrief).vessel.draft).toBe(1.6);
    vi.mocked(client.route).mockRejectedValueOnce(new Error('too deep'));
    await act(async () => { await tools.set_vessel.execute({ draft: 9 }); });
    await flush();
    await expect(tools.get_route_brief.execute({})).rejects.toThrow('No route: too deep');
    await act(async () => { await tools.set_vessel.execute({ draft: 1.6 }); });
    await flush();
    expect(await tools.find_place.execute({ query: 'x' })).toEqual([]);
    // nothing online, or offline: the waterway places in the data
    const { searchPlaces } = await import('./ui/search');
    expect(await tools.find_place.execute({ query: 'Sluza' })).toEqual([{ name: 'Śluza · lock', lon: 21, lat: 52 }]);
    vi.mocked(searchPlaces).mockRejectedValueOnce(new Error('offline'));
    expect(await tools.find_place.execute({ query: 'Sluza' })).toEqual([{ name: 'Śluza · lock', lon: 21, lat: 52 }]);
    vi.mocked(searchPlaces).mockResolvedValueOnce([{ label: 'Giżycko', position: [21.7, 54] }]);
    expect(await tools.find_place.execute({ query: 'Sluza' })).toEqual([{ name: 'Giżycko', lon: 21.7, lat: 54 }]);
    delete (document as { modelContext?: unknown }).modelContext;
  });

  it('copies the brief for AI assistants, falling back to a download', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    history.replaceState(null, '', '/?from=1,2&to=3,4');
    const writeText = vi.fn(async (text: string) => { void text; });
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    const createObjectURL = vi.fn(() => 'blob:y');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    render(<App client={fakeClient()} />);
    await flush();
    fireEvent.click(screen.getByText('Copy brief for AI'));
    await flush();
    expect(writeText.mock.calls[0][0]).toContain('## Editing this route (for AI assistants)');
    expect(screen.getByText('Copied ✓')).toBeTruthy();
    await act(async () => { vi.advanceTimersByTime(2100); });
    expect(screen.getByText('Copy brief for AI')).toBeTruthy();
    writeText.mockRejectedValueOnce(new Error('denied'));
    fireEvent.click(screen.getByText('Copy brief for AI'));
    await flush();
    expect(createObjectURL).toHaveBeenCalledTimes(1); // downloaded instead
    vi.useRealTimers();
  });
});
