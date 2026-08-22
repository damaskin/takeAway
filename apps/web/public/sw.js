/* takeAway service worker: web push, and the offline shell.
 *
 * Push
 * ----
 * Surfaces a system notification for events delivered by the browser's
 * push service. Payload shape is fixed by
 * apps/api/src/app/notifications/providers/web-push.provider.ts.
 * Tap → focuses (or opens) the order-status page for that order.
 *
 * Offline
 * -------
 * The app is installed on a phone and opened while walking to a store, on
 * a lift, in a basement café. Without a cached shell that is a dinosaur
 * page; with one it is the app, saying it cannot reach the server.
 *
 * Deliberately narrow: the shell and the icons are cached, and nothing
 * else. API responses are never cached — a stale ETA or a stale order
 * status is worse than an honest error, because the whole product is a
 * promise about a time.
 */

const SHELL_CACHE = 'takeaway-shell-v1';
const SHELL_ASSETS = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      // Individually, so one 404 during a deploy cannot fail the install
      // and leave the app with no worker at all.
      await Promise.all(SHELL_ASSETS.map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== SHELL_CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Never serve an API response from cache. A cached ETA or order status
  // would be a confident lie about a time, which is the one thing this
  // product cannot afford.
  if (url.pathname.startsWith('/api/')) return;

  // Navigations: network first, shell as the fallback. The customer sees
  // the app and its own error state rather than the browser's.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          return await fetch(request);
        } catch (err) {
          const cached = await caches.match('/index.html');
          return cached || Response.error();
        }
      })(),
    );
    return;
  }

  // Icons and the manifest: cache first, they never change within a build.
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(SHELL_CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      })(),
    );
  }
});

self.addEventListener('push', (event) => {
  let payload = { title: 'takeAway', body: '', orderId: undefined, kind: 'generic' };
  try {
    if (event.data) payload = { ...payload, ...event.data.json() };
  } catch (e) {
    payload.body = event.data ? event.data.text() : '';
  }

  const url = payload.orderId ? `/orders/${payload.orderId}` : '/';

  event.waitUntil(
    self.registration.showNotification(payload.title || 'takeAway', {
      body: payload.body || '',
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      data: { url },
      tag: payload.orderId ? `order-${payload.orderId}` : undefined,
      renotify: false,
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data && event.notification.data.url ? event.notification.data.url : '/';

  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      for (const client of all) {
        const u = new URL(client.url);
        if (u.pathname === target) {
          await client.focus();
          return;
        }
      }
      await self.clients.openWindow(target);
    })(),
  );
});
