/* Minimal service worker for the Vue3 demo.
 *
 * Clears all caches on activate so Safari and other browsers never serve
 * stale JS/CSS after a redeploy. Falls back to a network-only fetch strategy.
 */

self.addEventListener('install', (event) => {
  // Skip waiting so this SW activates immediately, replacing any old version.
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.map((key) => caches.delete(key)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Network-only: never serve from cache.
  event.respondWith(
    fetch(event.request, { cache: 'no-store' }).catch(() => fetch(event.request))
  );
});
