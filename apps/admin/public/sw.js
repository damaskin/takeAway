/* takeAway admin service worker: what makes the cabinet installable, and
 * an honest page when the network is gone.
 *
 * The cabinet is useless offline — every screen is live data — so this
 * worker caches nothing but the icons and the manifest, and never an API
 * response: a kitchen tablet showing a cached order list would be showing
 * orders that may already be gone. When a navigation cannot reach the
 * server, the installed app says so and offers to retry instead of turning
 * into the browser's dinosaur page.
 */

const CACHE = 'takeaway-admin-v1';
const ASSETS = ['/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

const OFFLINE_PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="theme-color" content="#ffffff">
<title>takeAway — нет связи</title>
<style>
  html, body { height: 100%; margin: 0; }
  body { display: flex; align-items: center; justify-content: center; background: #f8f3eb; color: #1a1414;
    font: 15px/1.5 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; text-align: center; padding: 24px; box-sizing: border-box; }
  img { width: 72px; height: 72px; border-radius: 18px; }
  h1 { font-size: 20px; margin: 16px 0 6px; }
  p { margin: 0 0 20px; color: #6b5f57; }
  button { height: 44px; padding: 0 22px; border: 0; border-radius: 12px; background: #c77d3b; color: #fff; font: inherit; font-weight: 600; }
</style>
</head>
<body>
  <div>
    <img src="/icons/icon-192.png" alt="">
    <h1>Нет связи с сервером</h1>
    <p>Проверьте интернет — кабинет откроется, как только связь вернётся.<br>No connection to the server.</p>
    <button type="button" onclick="location.reload()">Повторить / Retry</button>
  </div>
  <script>window.addEventListener('online', function () { location.reload(); });</script>
</body>
</html>`;

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // One by one, so a 404 mid-deploy cannot fail the install.
      await Promise.all(ASSETS.map((url) => cache.add(url).catch(() => undefined)));
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  // Live data and the realtime socket always go straight to the network.
  if (url.pathname.startsWith('/api/') || url.pathname.startsWith('/socket.io/')) return;

  // Navigations: always the network; the offline page only when it fails.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(
        () => new Response(OFFLINE_PAGE, { headers: { 'Content-Type': 'text/html; charset=utf-8' } }),
      ),
    );
    return;
  }

  // Icons and the manifest: cache first, so the offline page has its icon.
  if (url.pathname.startsWith('/icons/') || url.pathname === '/manifest.webmanifest') {
    event.respondWith(
      (async () => {
        const cached = await caches.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(CACHE);
          await cache.put(request, response.clone());
        }
        return response;
      })(),
    );
  }
});
