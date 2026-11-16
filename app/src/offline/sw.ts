/// <reference lib="webworker" />
// Service worker: makes the app, waterway data and viewed map tiles available offline.
import { cleanup, handleFetch, shouldHandle } from './strategy';

const sw = self as unknown as ServiceWorkerGlobalScope;

sw.addEventListener('install', () => {
  void sw.skipWaiting();
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(cleanup(sw.caches).then(() => sw.clients.claim()));
});

sw.addEventListener('fetch', (event) => {
  const origin = sw.location.origin;
  if (!shouldHandle(event.request, origin)) return;
  event.respondWith(handleFetch(event.request, origin, sw.caches, (r) => fetch(r), (p) => event.waitUntil(p)));
});
