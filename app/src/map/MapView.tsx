import * as maplibregl from 'maplibre-gl';
import type { GeoJSONSource, Map as MLMap, MapMouseEvent } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useEffect, useRef } from 'react';
import type { LngLat } from '../graph/geo';
import type { Route } from '../routing/router';

export interface MapViewProps {
  start: LngLat | null;
  end: LngLat | null;
  route: Route | null;
  position: GeolocationPosition | null;
  network: GeoJSON.FeatureCollection | null;
  showSeamarks: boolean;
  onMapClick: (p: LngLat) => void;
}

const BASEMAP = 'https://tiles.openfreemap.org/styles/liberty';
const SEAMARKS = 'https://tiles.openseamap.org/seamark/{z}/{x}/{y}.png';
const empty: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

function setData(map: MLMap, id: string, data: GeoJSON.GeoJSON) {
  (map.getSource(id) as GeoJSONSource).setData(data);
}

export function MapView({ start, end, route, position, network, showSeamarks, onMapClick }: MapViewProps) {
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MLMap | null>(null);
  const ready = useRef(false);
  const clickRef = useRef(onMapClick);
  const markers = useRef<{ a?: maplibregl.Marker; b?: maplibregl.Marker; me?: maplibregl.Marker }>({});
  const latest = useRef({ route, network, showSeamarks });
  useEffect(() => {
    clickRef.current = onMapClick;
    latest.current = { route, network, showSeamarks };
  });

  useEffect(() => {
    const map = new maplibregl.Map({
      container: container.current!,
      style: BASEMAP,
      center: [19.0, 52.0],
      zoom: 5.5,
      attributionControl: { compact: true, customAttribution: '© OpenSeaMap contributors' },
    });
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl(), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ unit: 'nautical' }), 'bottom-right');
    map.on('click', (e: MapMouseEvent) => clickRef.current([e.lngLat.lng, e.lngLat.lat]));
    map.on('load', () => {
      map.addSource('seamarks', { type: 'raster', tiles: [SEAMARKS], tileSize: 256, maxzoom: 18 });
      map.addLayer({ id: 'seamarks', type: 'raster', source: 'seamarks', minzoom: 9 });
      map.addSource('network', { type: 'geojson', data: empty });
      map.addLayer({ id: 'network', type: 'line', source: 'network', paint: { 'line-color': '#0a8', 'line-width': 1.5, 'line-opacity': 0.7 } });
      map.addSource('route', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'route-casing', type: 'line', source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#fff', 'line-width': 8 },
      });
      map.addLayer({
        id: 'route', type: 'line', source: 'route',
        layout: { 'line-join': 'round', 'line-cap': 'round' },
        paint: { 'line-color': '#d0336b', 'line-width': 4.5 },
      });
      map.addSource('locks', { type: 'geojson', data: empty });
      map.addLayer({
        id: 'locks', type: 'circle', source: 'locks',
        paint: { 'circle-radius': 6, 'circle-color': '#fc0', 'circle-stroke-color': '#333', 'circle-stroke-width': 1.5 },
      });
      ready.current = true;
      const l = latest.current;
      applyRoute(map, l.route);
      setData(map, 'network', l.network ?? empty);
      map.setLayoutProperty('seamarks', 'visibility', l.showSeamarks ? 'visible' : 'none');
    });
    return () => {
      map.remove();
      mapRef.current = null;
      ready.current = false;
    };
  }, []);

  useEffect(() => {
    // The map is created by the first effect, so it exists here; sources exist only after 'load'.
    const map = mapRef.current!;
    if (ready.current) applyRoute(map, route);
    if (route) {
      const b = new maplibregl.LngLatBounds();
      route.coordinates.forEach((c) => b.extend(c));
      map.fitBounds(b, { padding: 60, maxZoom: 14 });
    }
  }, [route]);

  useEffect(() => {
    if (ready.current) setData(mapRef.current!, 'network', network ?? empty);
  }, [network]);

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
    place('b', end, '#c33');
  }, [start, end]);

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

  return <div ref={container} className="map" />;
}

function applyRoute(map: MLMap, route: Route | null) {
  setData(map, 'route', route ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: route.coordinates } } : empty);
  setData(map, 'locks', {
    type: 'FeatureCollection',
    features: (route ? route.events : []).map((e) => ({
      type: 'Feature', properties: { name: e.name }, geometry: { type: 'Point', coordinates: [e.lon, e.lat] },
    })),
  });
}

