import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '../routing/router';

type Handler = (e?: unknown) => void;

const h = vi.hoisted(() => {
  const state = { maps: [] as FakeMapT[], markers: [] as FakeMarkerT[], popups: [] as { lngLat?: unknown; content?: HTMLElement }[], workerUrl: '' };
  interface FakeMapT {
    opts: Record<string, unknown>;
    layerSpecs: Record<string, { paint?: Record<string, unknown> }>;
    setStyle: ReturnType<typeof vi.fn>;
    handlers: Record<string, Handler>;
    sources: Record<string, { setData: ReturnType<typeof vi.fn>; spec: unknown }>;
    layers: string[];
    layout: Record<string, string>;
    fitBounds: ReturnType<typeof vi.fn>;
    remove: ReturnType<typeof vi.fn>;
  }
  interface FakeMarkerT {
    opts: Record<string, unknown>;
    lngLat?: unknown;
    rotation?: number;
    removed: boolean;
  }
  return { state };
});

vi.mock('maplibre-gl', () => {
  class Map {
    opts: Record<string, unknown>;
    handlers: Record<string, Handler> = {};
    sources: Record<string, { setData: ReturnType<typeof vi.fn>; spec: unknown }> = {};
    layers: string[] = [];
    layerSpecs: Record<string, unknown> = {};
    layout: Record<string, string> = {};
    setStyle = vi.fn();
    controls: unknown[] = [];
    fitBounds = vi.fn();
    flyTo = vi.fn();
    easeTo = vi.fn();
    hits: unknown[] = [];
    queryRenderedFeatures = vi.fn(() => this.hits);
    canvas = { style: { cursor: '' } };
    getCanvas() { return this.canvas; }
    getZoom = () => 10;
    getBearing = () => 33;
    remove = vi.fn();
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      h.state.maps.push(this as never);
    }
    addControl(c: unknown) { this.controls.push(c); }
    on(ev: string, fn: Handler) { this.handlers[ev] = fn; }
    addSource(id: string, spec: unknown) { this.sources[id] = { spec, setData: vi.fn() }; }
    addLayer(l: { id: string }) { this.layers.push(l.id); this.layerSpecs[l.id] = l; }
    getSource(id: string) { return this.sources[id]; }
    setLayoutProperty(id: string, _k: string, v: string) { this.layout[id] = v; }
  }
  class Marker {
    opts: Record<string, unknown>;
    lngLat?: unknown;
    rotation?: number;
    removed = false;
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      h.state.markers.push(this as never);
    }
    setLngLat(p: unknown) { this.lngLat = p; return this; }
    addTo() { return this; }
    remove() { this.removed = true; }
    setRotation(r: number) { this.rotation = r; }
  }
  class LngLatBounds {
    pts: unknown[] = [];
    extend(p: unknown) { this.pts.push(p); return this; }
  }
  class Popup {
    opts: unknown;
    lngLat?: unknown;
    content?: HTMLElement;
    constructor(opts: unknown) { this.opts = opts; h.state.popups.push(this as never); }
    setLngLat(p: unknown) { this.lngLat = p; return this; }
    setDOMContent(el: HTMLElement) { this.content = el; return this; }
    addTo() { return this; }
  }
  class NavigationControl {}
  class ScaleControl {}
  return { Map, Marker, Popup, LngLatBounds, NavigationControl, ScaleControl, setWorkerUrl: (u: string) => { h.state.workerUrl = u; } };
});

const { MapView } = await import('./MapView');
const { popupContent } = await import('./popup');

it('points maplibre at the bundled worker file', () => {
  expect(h.state.workerUrl).toContain('maplibre-gl-worker');
});

const route = {
  coordinates: [[21, 52], [21.5, 52.5]],
  events: [{ type: 'lock', name: 'Lock 1', lat: 52.2, lon: 21.2, at: 1 }],
} as unknown as Route;

const pos = (heading: number | null) => ({ coords: { longitude: 21, latitude: 52, heading } }) as GeolocationPosition;

const base = { start: null, end: null, route: null, position: null, network: null, showSeamarks: true, pois: [], onMapClick: () => {} };
const lock = { type: 'lock' as const, name: 'Śluza', lat: 52, lon: 21 };
const poiFc = (names: string[]) => ({
  type: 'FeatureCollection',
  features: names.map((name) => ({ type: 'Feature', properties: { type: 'lock', name, detail: '' }, geometry: { type: 'Point', coordinates: [21, 52] } })),
});

beforeEach(() => {
  h.state.maps.length = 0;
  h.state.markers.length = 0;
  h.state.popups.length = 0;
});

describe('MapView', () => {
  it('creates the map, adds layers on load and applies current state', () => {
    const net = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;
    const town = { type: 'place' as const, name: 'Toruń', lat: 53, lon: 18.6 };
    render(<MapView {...base} route={route} network={net} showSeamarks={false} pois={[lock, town]} />);
    const map = h.state.maps[0];
    expect(map.opts.style).toContain('openfreemap');
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    act(() => map.handlers.load());
    expect(map.layers).toEqual(['seamarks', 'network', 'pois', 'poi-labels', 'route-casing', 'route', 'limits', 'locks']);
    expect(map.sources.pois.setData).toHaveBeenCalledWith(poiFc(['Śluza']));
    expect(map.sources.limits.setData).toHaveBeenCalledWith({ type: 'FeatureCollection', features: [] });
    expect(map.layout.seamarks).toBe('none');
    expect(map.sources.network.setData).toHaveBeenCalledWith(net);
    expect(map.sources.route.setData).toHaveBeenCalledWith(expect.objectContaining({ geometry: expect.objectContaining({ type: 'LineString' }) }));
    expect(map.sources.locks.setData).toHaveBeenCalledWith({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { type: 'lock', name: 'Lock 1', at: 1 }, geometry: { type: 'Point', coordinates: [21.2, 52.2] } }],
    });
  });

  it('switches to the night basemap and puts its layers back once the new style has loaded', () => {
    const { rerender } = render(<MapView {...base} />);
    const map = h.state.maps[0];
    act(() => map.handlers['style.load']()); // the first style load: 'load' adds the layers
    expect(map.layers).toEqual([]);
    act(() => map.handlers.load());
    expect(map.layerSpecs.seamarks.paint).toEqual({ 'raster-opacity': 1 });
    rerender(<MapView {...base} />);
    expect(map.setStyle).not.toHaveBeenCalled();
    rerender(<MapView {...base} night />);
    expect(map.setStyle).toHaveBeenCalledWith(expect.stringContaining('/styles/dark'), { diff: false });
    // while the new style loads our sources are gone: updates wait
    rerender(<MapView {...base} night route={route} />);
    expect(map.sources.route.setData).toHaveBeenCalledTimes(1);
    map.layers.length = 0;
    act(() => map.handlers['style.load']());
    expect(map.layers).toContain('route');
    expect(map.layerSpecs.seamarks.paint).toEqual({ 'raster-opacity': 0.7 });
    expect(map.sources.route.setData).toHaveBeenLastCalledWith(expect.objectContaining({ geometry: expect.objectContaining({ type: 'LineString' }) }));
  });

  it('updates layers after load and ignores updates before load', () => {
    const { rerender } = render(<MapView {...base} />);
    const map = h.state.maps[0];
    rerender(<MapView {...base} showSeamarks={false} network={{ type: 'FeatureCollection', features: [] }} route={route} pois={[lock]} />);
    expect(map.layout.seamarks).toBeUndefined();
    act(() => map.handlers.load());
    rerender(<MapView {...base} />);
    expect(map.layout.seamarks).toBe('visible');
    expect(map.sources.pois.setData).toHaveBeenLastCalledWith(poiFc([]));
    rerender(<MapView {...base} pois={[lock]} />);
    expect(map.sources.pois.setData).toHaveBeenLastCalledWith(poiFc(['Śluza']));
    expect(map.sources.route.setData).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [] });
    expect(map.sources.locks.setData).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [] });
    expect(map.sources.network.setData).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [] });
    rerender(<MapView {...base} showSeamarks={false} />);
    expect(map.layout.seamarks).toBe('none');
    rerender(<MapView {...base} showSeamarks={false} route={route} />);
    expect(map.fitBounds).toHaveBeenCalledTimes(2);
  });

  it('forwards clicks to the latest handler', () => {
    const first = vi.fn(), second = vi.fn();
    const { rerender } = render(<MapView {...base} onMapClick={first} />);
    rerender(<MapView {...base} onMapClick={second} />);
    h.state.maps[0].handlers.click({ lngLat: { lng: 1, lat: 2 } });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith([1, 2]);
  });

  it('places, moves and removes A/B markers', () => {
    const { rerender } = render(<MapView {...base} start={[1, 1]} />);
    expect(h.state.markers).toHaveLength(1);
    rerender(<MapView {...base} start={[2, 2]} end={[3, 3]} />);
    expect(h.state.markers.map((m) => m.lngLat)).toEqual([[2, 2], [3, 3]]);
    rerender(<MapView {...base} end={[3, 3]} />);
    expect(h.state.markers[0].removed).toBe(true);
    rerender(<MapView {...base} start={[4, 4]} end={[3, 3]} />);
    expect(h.state.markers).toHaveLength(3);
    rerender(<MapView {...base} start={[4, 4]} end={[3, 3]} via={[[5, 5], [6, 6]]} />);
    expect(h.state.markers.slice(3).map((m) => m.lngLat)).toEqual([[5, 5], [6, 6]]);
    rerender(<MapView {...base} start={[4, 4]} end={[3, 3]} />);
    expect(h.state.markers.slice(3).every((m) => m.removed)).toBe(true);
  });

  it('shows the GPS position with heading when known', () => {
    const { rerender } = render(<MapView {...base} position={pos(null)} />);
    const me = h.state.markers[0];
    expect(me.rotation).toBeUndefined();
    expect((me.opts.element as HTMLElement).className).toBe('my-position');
    rerender(<MapView {...base} position={pos(Number.NaN)} />);
    expect(me.rotation).toBeUndefined();
    rerender(<MapView {...base} position={pos(90)} />);
    expect(me.rotation).toBe(90);
    expect(h.state.markers).toHaveLength(1);
  });

  it('loads with no route, no network and seamarks on', () => {
    render(<MapView {...base} />);
    const map = h.state.maps[0];
    act(() => map.handlers.load());
    expect(map.layout.seamarks).toBe('visible');
    expect(map.sources.network.setData).toHaveBeenCalledWith({ type: 'FeatureCollection', features: [] });
  });

  it('flies to a focused point', () => {
    const { rerender } = render(<MapView {...base} />);
    const map = h.state.maps[0] as unknown as { flyTo: ReturnType<typeof vi.fn> };
    expect(map.flyTo).not.toHaveBeenCalled();
    rerender(<MapView {...base} focus={[18.1, 53.1]} />);
    expect(map.flyTo).toHaveBeenCalledWith({ center: [18.1, 53.1], zoom: 14 });
  });

  it('follows the boat heading up while navigating, until the user moves the map', () => {
    const onUserMove = vi.fn();
    const props = { ...base, follow: true, onUserMove, fitRoute: false };
    const { rerender } = render(<MapView {...props} route={route} />);
    const map = h.state.maps[0] as unknown as { easeTo: ReturnType<typeof vi.fn>; fitBounds: ReturnType<typeof vi.fn>; handlers: Record<string, Handler> };
    expect(map.fitBounds).not.toHaveBeenCalled(); // a re-route keeps the view
    expect(map.easeTo).not.toHaveBeenCalled(); // no fix yet
    rerender(<MapView {...props} route={route} position={pos(null)} />);
    expect(map.easeTo).toHaveBeenLastCalledWith({ center: [21, 52], bearing: 33, zoom: 14, duration: 600 });
    rerender(<MapView {...props} route={route} position={pos(null)} course={120} />);
    expect(map.easeTo).toHaveBeenLastCalledWith(expect.objectContaining({ bearing: 120 }));
    map.handlers.dragstart({}); // our own easeTo
    expect(onUserMove).not.toHaveBeenCalled();
    map.handlers.dragstart({ originalEvent: {} });
    map.handlers.rotatestart({ originalEvent: {} });
    expect(onUserMove).toHaveBeenCalledTimes(2);
    const calls = map.easeTo.mock.calls.length;
    rerender(<MapView {...props} follow={false} route={route} position={pos(90)} />);
    expect(map.easeTo).toHaveBeenCalledTimes(calls);
    rerender(<MapView {...base} />);
    map.handlers.dragstart({ originalEvent: {} }); // no handler: nothing to tell
  });

  it('opens a popup for a lock or bridge under the click unless a point is being placed', () => {
    const onMapClick = vi.fn();
    const stops = [{ poi: { type: 'lock' as const, name: 'Śluza', lat: 52, lon: 21, maxlength: 57, maxwidth: 9.6 }, at: 12_345, offset: 80 }];
    const { rerender } = render(<MapView {...base} onMapClick={onMapClick} stops={stops} />);
    const map = h.state.maps[0] as unknown as { hits: unknown[]; handlers: Record<string, Handler>; canvas: { style: { cursor: string } } };
    const click = { point: { x: 1, y: 2 }, lngLat: { lng: 21, lat: 52 } };
    const feature = { properties: { type: 'lock', name: 'Śluza', detail: '57 × 9.6 m' }, geometry: { type: 'Point', coordinates: [21, 52] } };
    map.hits = [feature];
    map.handlers.click(click); // before load: no layers to look at
    expect(onMapClick).toHaveBeenCalledTimes(1);
    act(() => map.handlers.load());
    map.handlers.click(click);
    expect(onMapClick).toHaveBeenCalledTimes(1);
    expect(h.state.popups[0].lngLat).toEqual([21, 52]);
    expect(h.state.popups[0].content!.textContent).toBe('LockŚluza57 × 9.6 mkm 12.3 on the route0.1 km off the route');
    map.handlers.mousemove(click);
    expect(map.canvas.style.cursor).toBe('pointer');
    rerender(<MapView {...base} onMapClick={onMapClick} stops={stops} picking />);
    map.handlers.click(click);
    expect(onMapClick).toHaveBeenCalledTimes(2);
    map.hits = [];
    map.handlers.mousemove(click);
    expect(map.canvas.style.cursor).toBe('');
    rerender(<MapView {...base} onMapClick={onMapClick} />);
    map.handlers.click(click);
    expect(onMapClick).toHaveBeenCalledTimes(3);
  });

  it('describes route locks and services off the route', () => {
    const text = (props: Record<string, unknown>, at: [number, number], stops = []) => popupContent(props, at, stops).textContent;
    expect(text({ name: 'Lock 1', at: 2500 }, [1, 1])).toBe('LockLock 1km 2.5 on the route');
    expect(text({ type: 'fuel' }, [1, 1])).toBe('Fuel');
    const near = [{ poi: { type: 'marina' as const, name: 'M', lat: 1, lon: 1 }, at: 900, offset: 20 }];
    expect(popupContent({ type: 'marina', name: 'M', detail: '' }, [1, 1], near).textContent).toBe('MarinaMkm 0.9 on the route');
  });

  it('rings the structures that limit the boat', () => {
    const { rerender } = render(<MapView {...base} limits={[[21, 52]]} />);
    const map = h.state.maps[0];
    act(() => map.handlers.load());
    expect(map.sources.limits.setData).toHaveBeenLastCalledWith({
      type: 'FeatureCollection', features: [{ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [21, 52] } }],
    });
    rerender(<MapView {...base} limits={[]} />);
    expect(map.sources.limits.setData).toHaveBeenLastCalledWith({ type: 'FeatureCollection', features: [] });
  });

  it('removes the map on unmount', () => {
    const { unmount } = render(<MapView {...base} />);
    unmount();
    expect(h.state.maps[0].remove).toHaveBeenCalled();
  });
});
