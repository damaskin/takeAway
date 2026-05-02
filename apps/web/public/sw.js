/* takeAway web push service worker.
 *
 * Listens for push events delivered by the browser's push service and
 * surfaces a system notification. The payload shape is fixed by
 * apps/api/src/app/notifications/providers/web-push.provider.ts.
 *
 * Tap → focuses (or opens) the order-status page for that order.
 */

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
      icon: '/favicon.ico',
      badge: '/favicon.ico',
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
