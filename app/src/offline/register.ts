/** Registers the service worker in production builds (in dev it would cache stale modules). */
export function registerServiceWorker(nav: Navigator, enabled: boolean, url: string): Promise<boolean> {
  if (!enabled || !('serviceWorker' in nav)) return Promise.resolve(false);
  return nav.serviceWorker.register(url, { scope: './' }).then(
    () => true,
    (e: unknown) => {
      console.warn('Offline mode unavailable:', e);
      return false;
    },
  );
}
