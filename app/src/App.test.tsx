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
    expect(screen.getByText('123 km')).toBeTruthy();
    expect(screen.getByText('(66.7 NM)')).toBeTruthy();
    expect(screen.getByText('5 h 0 min at 10 km/h · 2 locks')).toBeTruthy();
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

    const far = fakeClient({ route: vi.fn(async () => route({ start: { ...route().start, offset: 1500 }, unverified: 2500, sea: 18520, tooShallow: 4000, shallowest: { draft: 2.3, at: 40_000 } })) });
    render(<App client={far} />);
    await flush();
    expect(screen.getByText(/snapped to the nearest navigable water \(1\.5 km/)).toBeTruthy();
    expect(screen.getByText(/Includes 2\.5 km on unverified connections/)).toBeTruthy();
    expect(screen.getByText(/10\.0 NM on open sea/).textContent).toContain('Shallowest stretch allows about 2.3 m draft (km 40). 4 km charted shallower than your draft');
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
    expect(screen.queryByText('999 km')).toBeNull();
    expect(screen.getByText('second failed')).toBeTruthy();
    fireEvent.click(screen.getByTitle('Swap')); // request 3
    await flush();
    fireEvent.click(screen.getByTitle('Swap')); // request 4 makes request 3 stale
    await flush();
    await act(async () => pending[2].reject(new Error('stale error')));
    await act(async () => pending[3].resolve(route()));
    expect(screen.queryByText('stale error')).toBeNull();
    expect(screen.getByText('123 km')).toBeTruthy();
  });

  it('uses GPS for A and B and keeps watching', async () => {
    const { geo, watchers, fix } = geolocation();
    const client = fakeClient();
    render(<App client={client} />);
    await flush();
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
    fireEvent.click(screen.getByText('Start navigation'));
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
    // three fixes well off the line: plan again from the boat; the link keeps the planned route
    for (let i = 1; i <= 3; i++) await act(async () => watchers[0].ok(at(21.4, 52.1, 1000 + i * 1000)));
    await flush();
    expect(client.route).toHaveBeenLastCalledWith([21.4, 52.1], [21.5, 52.5], defaultProfile, []);
    expect(location.search).toBe(planned);
    expect(screen.getAllByPlaceholderText('My position').length).toBeGreaterThan(0);
    expect(mapProps.current!.course).toBeNull();
    fireEvent.click(screen.getByText('Stop'));
    expect(screen.queryByLabelText('Navigation')).toBeNull();
    expect(location.search).toContain('from=21.40000,52.10000');
  });

  it('says why navigation could not start', async () => {
    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    history.replaceState(null, '', '/?from=21,52&to=21.5,52.5');
    render(<App client={fakeClient()} />);
    await flush();
    fireEvent.click(screen.getByText('Start navigation'));
    await flush();
    expect(screen.getByText('Navigation: Geolocation not supported')).toBeTruthy();
    expect(screen.queryByLabelText('Navigation')).toBeNull();
  });

  it('reports GPS errors and missing GPS', async () => {
    const { watchers } = geolocation();
    const { unmount } = render(<App client={fakeClient()} />);
    fireEvent.click(screen.getAllByText('My position')[0]);
    await act(async () => watchers[0].err({ message: 'denied' } as GeolocationPositionError));
    expect(screen.getByText('GPS: denied')).toBeTruthy();
    unmount();

    Object.defineProperty(navigator, 'geolocation', { value: undefined, configurable: true });
    render(<App client={fakeClient()} />);
    fireEvent.click(screen.getAllByText('My position')[0]);
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
    fireEvent.click(screen.getByText('+ Add waypoint'));
    fireEvent.click(screen.getByText('Click the map to add a waypoint…'));
    fireEvent.click(screen.getByText('+ Add waypoint'));
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
    history.replaceState(null, '', '/?from=1,2&to=3,4');
    const client = fakeClient();
    render(<App client={client} />);
    await flush();
    expect(client.route).toHaveBeenLastCalledWith([1, 2], [3, 4], { ...defaultProfile, draft: 1.8 }, []);
    fireEvent.change(screen.getByLabelText('Air draft (m)'), { target: { value: '4.5' } });
    fireEvent.click(screen.getByLabelText('Avoid locks'));
    fireEvent.click(screen.getByLabelText('Avoid open sea'));
    await flush();
    const expected = { ...defaultProfile, draft: 1.8, airDraft: 4.5, avoidLocks: true, avoidSea: true };
    expect(client.route).toHaveBeenLastCalledWith([1, 2], [3, 4], expected, []);
    // only what differs from the defaults is saved
    expect(JSON.parse(localStorage.getItem('interway.profile')!)).toEqual({ draft: 1.8, airDraft: 4.5, avoidLocks: true, avoidSea: true });
  });

  it('toggles layers and loads the debug network once', async () => {
    const client = fakeClient();
    render(<App client={client} />);
    await flush();
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

  it('reports network loading errors', async () => {
    const client = fakeClient({ network: vi.fn(async () => { throw new Error('network failed'); }) });
    render(<App client={client} />);
    await flush();
    fireEvent.click(screen.getByLabelText('Routable network (debug)'));
    await flush();
    expect(screen.getByText('network failed')).toBeTruthy();
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
