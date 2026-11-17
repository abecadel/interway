import { act, render } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Route } from '../routing/router';

type Handler = (e?: unknown) => void;

const h = vi.hoisted(() => {
  const state = { maps: [] as FakeMapT[], markers: [] as FakeMarkerT[] };
  interface FakeMapT {
    opts: Record<string, unknown>;
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
    layout: Record<string, string> = {};
    controls: unknown[] = [];
    fitBounds = vi.fn();
    flyTo = vi.fn();
    remove = vi.fn();
    constructor(opts: Record<string, unknown>) {
      this.opts = opts;
      h.state.maps.push(this as never);
    }
    addControl(c: unknown) { this.controls.push(c); }
    on(ev: string, fn: Handler) { this.handlers[ev] = fn; }
    addSource(id: string, spec: unknown) { this.sources[id] = { spec, setData: vi.fn() }; }
    addLayer(l: { id: string }) { this.layers.push(l.id); }
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
  class NavigationControl {}
  class ScaleControl {}
  return { Map, Marker, LngLatBounds, NavigationControl, ScaleControl };
});

const { MapView } = await import('./MapView');

const route = {
  coordinates: [[21, 52], [21.5, 52.5]],
  events: [{ type: 'lock', name: 'Lock 1', lat: 52.2, lon: 21.2, at: 1 }],
} as unknown as Route;

const pos = (heading: number | null) => ({ coords: { longitude: 21, latitude: 52, heading } }) as GeolocationPosition;

const base = { start: null, end: null, route: null, position: null, network: null, showSeamarks: true, pois: [], onMapClick: () => {} };
const lock = { type: 'lock' as const, name: 'Śluza', lat: 52, lon: 21 };
const poiFc = (names: string[]) => ({
  type: 'FeatureCollection',
  features: names.map((name) => ({ type: 'Feature', properties: { type: 'lock', name }, geometry: { type: 'Point', coordinates: [21, 52] } })),
});

beforeEach(() => {
  h.state.maps.length = 0;
  h.state.markers.length = 0;
});

describe('MapView', () => {
  it('creates the map, adds layers on load and applies current state', () => {
    const net = { type: 'FeatureCollection', features: [] } as GeoJSON.FeatureCollection;
    render(<MapView {...base} route={route} network={net} showSeamarks={false} pois={[lock]} />);
    const map = h.state.maps[0];
    expect(map.opts.style).toContain('openfreemap');
    expect(map.fitBounds).toHaveBeenCalledTimes(1);
    act(() => map.handlers.load());
    expect(map.layers).toEqual(['seamarks', 'network', 'pois', 'poi-labels', 'route-casing', 'route', 'locks']);
    expect(map.sources.pois.setData).toHaveBeenCalledWith(poiFc(['Śluza']));
    expect(map.layout.seamarks).toBe('none');
    expect(map.sources.network.setData).toHaveBeenCalledWith(net);
    expect(map.sources.route.setData).toHaveBeenCalledWith(expect.objectContaining({ geometry: expect.objectContaining({ type: 'LineString' }) }));
    expect(map.sources.locks.setData).toHaveBeenCalledWith({
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: { name: 'Lock 1' }, geometry: { type: 'Point', coordinates: [21.2, 52.2] } }],
    });
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

  it('removes the map on unmount', () => {
    const { unmount } = render(<MapView {...base} />);
    unmount();
    expect(h.state.maps[0].remove).toHaveBeenCalled();
  });
});
