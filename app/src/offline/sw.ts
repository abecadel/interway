/// <reference lib="webworker" />
// Service worker: makes the app, waterway data and viewed map tiles available offline.
import { cleanup, handleFetch, precache, shouldHandle } from './strategy';

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', (event) => {
  event.waitUntil(precache(sw.registration.scope, sw.caches, (r) => fetch(r)));
  void sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(cleanup(sw.caches).then(() => sw.clients.claim()));
});

sw.addEventListener('fetch', (event) => {
  const origin = sw.location.origin;
  if (!shouldHandle(event.request, origin)) return;
  event.respondWith(handleFetch(event.request, origin, sw.caches, (r) => fetch(r), (p) => event.waitUntil(p), sw.registration.scope));
});
