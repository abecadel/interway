import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MLMap, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
import { useEffect, useRef } from 'react';
import type { LngLat } from '../graph/geo';
import type { Route } from '../routing/router';
import type { Poi } from '../routing/service';
import { poiDetail } from '../ui/format';
import { loadView, saveView } from './view';

// maplibre-gl v6 looks for its worker next to its own module, which the production bundle does not keep;
// point it at the worker file Vite emits instead (also under a GitHub Pages sub-path).
maplibregl.setWorkerUrl(workerUrl);

export interface MapViewProps {
  start: LngLat | null;
  end: LngLat | null;
  /** waypoints between start and end */
  via?: LngLat[];
  route: Route | null;
  position: GeolocationPosition | null;
  network: GeoJSON.FeatureCollection | null;
  showSeamarks: boolean;
  pois: Poi[];
  /** fly here when it changes (e.g. a stop picked in the itinerary) */
  focus?: LngLat | null;
  onMapClick: (p: LngLat) => void;
  /** navigation: keep the boat centred, heading up along `course` */
  follow?: boolean;
  /** course over ground, degrees, when under way */
  course?: number | null;
  /** the user panned or rotated the map (ends follow mode) */
  onUserMove?: () => void;
  /** zoom to a new route (off while navigating, so a re-route keeps the view) */
  fitRoute?: boolean;
  /** the structures that limit the boat on this route (lowest bridge, narrowest and shortest lock): ringed */
  limits?: LngLat[];
  /** a click sets a point (A, B, waypoint) rather than opening a popup */
  picking?: boolean;
  /** dark basemap with dimmed seamarks */
  night?: boolean;
  /** a lock, bridge or service was tapped (not while picking) */
  onFeatureClick?: (f: MapFeature) => void;
  /** long press (touch) or right click: drop a pin here */
  onLongPress?: (p: LngLat) => void;
  /** the map stopped moving: its centre */
  onViewChange?: (center: LngLat) => void;
  /** the route is on screen (the map draws a new one a moment after it is set) */
  onRouteDrawn?: (route: Route | null) => void;
  /** the place shown in the place sheet: a pin */
  place?: LngLat | null;
  /** other routes on offer: grey lines with their time, tapped to choose */
  alternatives?: AltLine[];
  onAlternative?: (i: number) => void;
}

export interface AltLine {
  coordinates: LngLat[];
  /** "6 h 40 min" */
  label: string;
}
const NO_ALTS: AltLine[] = [];

/** What a tap on a map symbol hands over: the POI's kind, name, limits, and km on the route when known. */
export interface MapFeature {
  type: string;
  name: string;
  detail: string;
  position: LngLat;
  /** metres from the route start (route locks) */
  at?: number;
}

const LONG_PRESS_MS = 550;

const BASEMAP = 'https://tiles.openfreemap.org/styles/liberty';
const BASEMAP_NIGHT = 'https://tiles.openfreemap.org/styles/dark';
const styleOf = (night: boolean) => (night ? BASEMAP_NIGHT : BASEMAP);
const SEAMARKS = 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png';
const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };
const NO_VIA: LngLat[] = [];
const FOLLOW_ZOOM = 14;
const CLICKABLE = ['locks', 'pois'];
const ALT_LAYERS = ['alts', 'alt-labels'];

function setData(map: MLMap, id: string, data: GeoJSON.GeoJSON) {
  (map.getSource(id) as GeoJSONSource).setData(data);
}

/** the longest a new route is reported as not yet drawn */
export const DRAWN_MAX_MS = 1500;

export function MapView({
  start, end, via = NO_VIA, route, position, network, showSeamarks, pois, focus = null, onMapClick,
  follow = false, course = null, onUserMove, fitRoute = true, limits = NO_VIA, picking = false,
  night = false, onFeatureClick, onLongPress, onViewChange, place = null, alternatives = NO_ALTS, onAlternative, onRouteDrawn,
}: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  // ready: our sources exist (false while a new basemap style loads); loaded: the map's first load is done
  const ready = useRef(false);
  const loaded = useRef(false);
  const clickRef = useRef(onMapClick);
  const moveRef = useRef(onUserMove);
  const fitRef = useRef(fitRoute);
  const markers = useRef<{ a?: maplibregl.Marker; b?: maplibregl.Marker; me?: maplibregl.Marker; place?: maplibregl.Marker }>({});
  const featureRef = useRef(onFeatureClick);
  const longRef = useRef(onLongPress);
  const viewRef = useRef(onViewChange);
  const altRef = useRef(onAlternative);
  const drawnRef = useRef(onRouteDrawn);
  const viaMarkers = useRef<maplibregl.Marker[]>([]);
  const latest = useRef({ route, network, showSeamarks, pois, limits, picking, night, alternatives });
  const styleRef = useRef(styleOf(night));
  useEffect(() => {
    clickRef.current = onMapClick;
    moveRef.current = onUserMove;
    fitRef.current = fitRoute;
    featureRef.current = onFeatureClick;
    longRef.current = onLongPress;
    viewRef.current = onViewChange;
    altRef.current = onAlternative;
    drawnRef.current = onRouteDrawn;
    latest.current = { route, network, showSeamarks, pois, limits, picking, night, alternatives };
  });

  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: styleRef.current,
      ...loadView(),
      attributionControl: { compact: true, customAttribution: '© OpenSeaMap contributors' },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'nautical' }), 'bottom-left');
    map.on('click', (e: MapMouseEvent) => {
      // a lock, bridge or service under the click opens its place sheet, unless the user is placing A, B or a waypoint
      const alt = ready.current && altRef.current ? map.queryRenderedFeatures(e.point, { layers: ALT_LAYERS })[0] : undefined;
      if (alt) {
        altRef.current!(Number(alt.properties.i));
        return;
      }
      const hit = ready.current && !latest.current.picking ? map.queryRenderedFeatures(e.point, { layers: CLICKABLE })[0] : undefined;
      if (hit && featureRef.current) featureRef.current(featureOf(hit));
      else clickRef.current([e.lngLat.lng, e.lngLat.lat]);
    });
    // drop a pin: right click, or a finger held still
    map.on('contextmenu', (e: MapMouseEvent) => longRef.current?.([e.lngLat.lng, e.lngLat.lat]));
    let press: ReturnType<typeof setTimeout> | undefined;
    const cancelPress = () => clearTimeout(press);
    map.on('touchstart', (e: maplibregl.MapTouchEvent) => {
      cancelPress();
      if (e.points.length !== 1) return;
      press = setTimeout(() => longRef.current?.([e.lngLat.lng, e.lngLat.lat]), LONG_PRESS_MS);
    });
    map.on('touchmove', cancelPress);
    map.on('touchend', cancelPress);
    map.on('touchcancel', cancelPress);
    map.on('moveend', () => {
      const c = map.getCenter();
      saveView({ center: [c.lng, c.lat], zoom: map.getZoom() });
      viewRef.current?.([c.lng, c.lat]);
    });
    map.on('mousemove', (e: MapMouseEvent) => {
      const over = ready.current && map.queryRenderedFeatures(e.point, { layers: CLICKABLE }).length > 0;
      map.getCanvas().style.cursor = over ? 'pointer' : '';
    });
    // only gestures carry the browser event; easeTo calls from follow mode do not
    const userMove = (e: { originalEvent?: unknown }) => { if (e.originalEvent) moveRef.current?.(); };
    map.on('dragstart', userMove);
    map.on('rotatestart', userMove);
    // Our sources and layers sit on top of the basemap style; a style change (day/night) drops them, so they
    // are added on the first load and again whenever a new style has loaded.
    const addOverlays = () => {
      map.addSource('seamarks', { type: 'raster', tiles: [SEAMARKS], tileSize: 256, maxzoom: 18 });
      map.addLayer({
        id: 'seamarks', type: 'raster', source: 'seamarks', minzoom: 9,
        paint: { 'raster-opacity': latest.current.night ? 0.7 : 1 },
      });
      map.addSource('network', { type: 'geojson', data: empty });
      map.addLayer({ id: 'network', type: 'line', source: 'network', paint: { 'line-color': '#0a8', 'line-width': 1.5, 'line-opacity': 0.7 } });
      map.addSource('pois', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'pois', type: 'circle', source: 'pois', minzoom: 8,
        paint: {
          'circle-radius': 5,
          'circle-color': ['match', ['get', 'type'],
            'lock', '#fc0', 'bridge', '#8a5a00', 'marina', '#1a73e8', 'port', '#0b3d91', 'fuel', '#d0336b',
            'slipway', '#2a7', 'water', '#29b6f6', 'sanitary', '#7e57c2', '#888'],
          'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
        },
      });
      map.addLayer({
        id: 'poi-labels', type: 'symbol', source: 'pois', minzoom: 11,
        layout: { 'text-field': ['get', 'name'], 'text-size': 11, 'text-offset': [0, 1.1], 'text-anchor': 'top' },
        paint: { 'text-color': '#234', 'text-halo-color': '#fff', 'text-halo-width': 1.2 },
      });
      map.addSource('alts', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'alts', type: 'line', source: 'alts',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#9aa0a6', 'line-width': 6 },
      });
      map.addSource('alt-labels', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'alt-labels', type: 'symbol', source: 'alt-labels',
        layout: { 'text-field': ['get', 'label'], 'text-size': 13, 'text-allow-overlap': true },
        paint: { 'text-color': '#3c4043', 'text-halo-color': '#fff', 'text-halo-width': 2.5 },
      });
      map.addSource('route', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'route-casing', type: 'line', source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#0b57d0', 'line-width': 9 },
      });
      map.addLayer({
        id: 'route', type: 'line', source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#4c8df6', 'line-width': 6 },
      });
      map.addSource('limits', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'limits', type: 'circle', source: 'limits',
        paint: { 'circle-radius': 12, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-color': '#c33', 'circle-stroke-width': 3 },
      });
      map.addSource('locks', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'locks', type: 'circle', source: 'locks',
        paint: { 'circle-radius': 6, 'circle-color': '#fc0', 'circle-stroke-color': '#333', 'circle-stroke-width': 1.5 },
      });
      const l = latest.current;
      applyRoute(map, l.route);
      setData(map, 'network', l.network ?? empty);
      setData(map, 'pois', poiCollection(l.pois));
      setData(map, 'limits', points(l.limits));
      applyAlternatives(map, l.alternatives);
      map.setLayoutProperty('seamarks', 'visibility', l.showSeamarks ? 'visible' : 'none');
    };
    map.on('load', () => {
      loaded.current = true;
      addOverlays();
      ready.current = true;
    });
    // the first style load comes before 'load', which adds the overlays itself
    map.on('style.load', () => {
      if (!loaded.current) return;
      addOverlays();
      ready.current = true;
    });
    return () => {
      map.remove();
      mapRef.current = null;
      ready.current = false;
      loaded.current = false;
    };
  }, []);

  useEffect(() => {
    // The map is created by the first effect, so it exists here; sources exist only after 'load'.
    const map = mapRef.current!;
    if (ready.current) {
      applyRoute(map, route);
      // drawn once the map settles; a map that keeps moving (following the boat) still reports it soon
      let done = false;
      const drawn = () => {
        if (done) return;
        done = true;
        drawnRef.current?.(route);
      };
      map.once('idle', drawn);
      setTimeout(drawn, DRAWN_MAX_MS);
    } else drawnRef.current?.(route); // no basemap yet (or offline without one): nothing to wait for
    if (route && fitRef.current) {
      const b = new maplibregl.LngLatBounds();
      route.coordinates.forEach((c) => b.extend(c));
      map.fitBounds(b, { padding: 60, maxZoom: 14 });
    }
  }, [route]);

  useEffect(() => {
    if (ready.current) setData(mapRef.current!, 'network', network ?? empty);
  }, [network]);

  useEffect(() => {
    const url = styleOf(night);
    if (url === styleRef.current) return;
    styleRef.current = url;
    ready.current = false;
    mapRef.current!.setStyle(url, { diff: false }); // a full reload fires 'style.load', which re-adds the overlays
  }, [night]);

  useEffect(() => {
    if (ready.current) setData(mapRef.current!, 'pois', poiCollection(pois));
  }, [pois]);

  useEffect(() => {
    if (ready.current) setData(mapRef.current!, 'limits', points(limits));
  }, [limits]);

  useEffect(() => {
    if (ready.current) applyAlternatives(mapRef.current!, alternatives);
  }, [alternatives]);

  useEffect(() => {
    if (focus) mapRef.current!.flyTo({ center: focus, zoom: 14 });
  }, [focus]);

  useEffect(() => {
    if (ready.current) mapRef.current!.setLayoutProperty('seamarks', 'visibility', showSeamarks ? 'visible' : 'none');
  }, [showSeamarks]);

  useEffect(() => {
    const map = mapRef.current!;
    const m = markers.current;
    const place = (key: 'a' | 'b', p: LngLat | null, color: string) => {
      if (!p) {
        m[key]?.remove();
        m[key] = undefined;
      } else if (m[key]) m[key]!.setLngLat(p);
      else m[key] = new maplibregl.Marker({ color }).setLngLat(p).addTo(map);
    };
    place('a', start, '#2a7');
    place('b', end, '#ea4335');
  }, [start, end]);

  useEffect(() => {
    const m = markers.current;
    if (!place) {
      m.place?.remove();
      m.place = undefined;
    } else if (m.place) m.place.setLngLat(place);
    else m.place = new maplibregl.Marker({ color: '#ea4335' }).setLngLat(place).addTo(mapRef.current!);
  }, [place]);

  useEffect(() => {
    const map = mapRef.current!;
    viaMarkers.current.forEach((m) => m.remove());
    viaMarkers.current = via.map((p) => new maplibregl.Marker({ color: '#e90', scale: 0.7 }).setLngLat(p).addTo(map));
  }, [via]);

  useEffect(() => {
    const map = mapRef.current!;
    const m = markers.current;
    if (!position) return;
    const p: LngLat = [position.coords.longitude, position.coords.latitude];
    if (!m.me) {
      const el = document.createElement('div');
      el.className = 'my-position';
      m.me = new maplibregl.Marker({ element: el, rotationAlignment: 'map' }).setLngLat(p).addTo(map);
    } else m.me.setLngLat(p);
    if (position.coords.heading != null && !Number.isNaN(position.coords.heading)) m.me.setRotation(position.coords.heading);
  }, [position]);

  useEffect(() => {
    if (!follow || !position) return;
    const map = mapRef.current!;
    map.easeTo({
      center: [position.coords.longitude, position.coords.latitude],
      bearing: course ?? map.getBearing(),
      zoom: Math.max(map.getZoom(), FOLLOW_ZOOM),
      duration: 600,
    });
  }, [follow, position, course]);

  return <div ref={container} className="map" />;
}

function poiCollection(pois: Poi[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    // towns are named on the basemap already
    features: pois.filter((p) => p.type !== 'place').map((p) => ({
      type: 'Feature', properties: { type: p.type, name: p.name, detail: poiDetail(p) }, geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    })),
  };
}

function applyRoute(map: MLMap, route: Route | null) {
  setData(map, 'route', route ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.coordinates } } : empty);
  setData(map, 'locks', {
    type: 'FeatureCollection',
    features: (route ? route.events : []).map((e) => ({
      type: 'Feature', properties: { type: 'lock', name: e.name, at: e.at }, geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
    })),
  });
}


function points(ps: LngLat[]): GeoJSON.FeatureCollection {
  return { type: 'FeatureCollection', features: ps.map((p) => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: p } })) };
}

/** Grey lines for the other routes, each labelled with its time halfway along. */
function applyAlternatives(map: MLMap, alts: AltLine[]) {
  setData(map, 'alts', {
    type: 'FeatureCollection',
    features: alts.map((a, i) => ({ type: 'Feature', properties: { i }, geometry: { type: 'LineString', coordinates: a.coordinates } })),
  });
  setData(map, 'alt-labels', {
    type: 'FeatureCollection',
    features: alts.map((a, i) => ({
      type: 'Feature', properties: { i, label: a.label },
      geometry: { type: 'Point', coordinates: a.coordinates[Math.floor(a.coordinates.length / 2)] },
    })),
  });
}

function featureOf(f: maplibregl.MapGeoJSONFeature): MapFeature {
  const p = f.properties;
  return {
    type: String(p.type ?? 'lock'), name: String(p.name ?? ''), detail: String(p.detail ?? ''),
    position: (f.geometry as GeoJSON.Point).coordinates as LngLat,
    ...(typeof p.at === 'number' ? { at: p.at } : {}),
  };
}
