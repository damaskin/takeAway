import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { firstValueFrom } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/**
 * One-shot helper that turns a logged-in browser into a Web-Push
 * subscriber: registers /sw.js, fetches the VAPID public key, calls
 * `pushManager.subscribe` and POSTs the resulting subscription to
 * `/devices`. Idempotent — calling it twice is a no-op because the API
 * uses an upsert keyed by token.
 *
 * The order-status page calls this once after a successful order create
 * so customers get the READY push without an explicit "enable
 * notifications" toggle. Browsers that haven't yet granted permission
 * silently bail; users can re-arm via /profile/notifications later.
 */
@Injectable({ providedIn: 'root' })
export class WebPushService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  /** True when the runtime can subscribe at all (HTTPS + service-worker + Push API). */
  isSupported(): boolean {
    return (
      typeof window !== 'undefined' &&
      'serviceWorker' in navigator &&
      'PushManager' in window &&
      'Notification' in window
    );
  }

  /**
   * Register the service worker, request permission if needed, and POST
   * the subscription. Returns true when a subscription is on file at the
   * end of the call (existing or freshly created), false otherwise.
   */
  async ensureSubscribed(): Promise<boolean> {
    if (!this.isSupported()) return false;

    const reg = await this.registerSw();
    if (!reg) return false;

    let permission = Notification.permission;
    if (permission === 'default') {
      permission = await Notification.requestPermission();
    }
    if (permission !== 'granted') return false;

    let sub = await reg.pushManager.getSubscription();
    if (!sub) {
      const { key } = await firstValueFrom(
        this.http.get<{ key: string | null }>(`${this.api.baseUrl}/devices/vapid-public-key`),
      );
      if (!key) return false;
      try {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(key) as unknown as BufferSource,
        });
      } catch {
        return false;
      }
    }

    const json = sub.toJSON();
    await firstValueFrom(
      this.http.post(`${this.api.baseUrl}/devices`, {
        type: 'WEB',
        endpoint: json.endpoint,
        keys: { p256dh: json.keys?.['p256dh'], auth: json.keys?.['auth'] },
      }),
    );
    return true;
  }

  /** Drop the current subscription on the backend and tear it down locally. */
  async unsubscribe(): Promise<void> {
    if (!this.isSupported()) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = reg ? await reg.pushManager.getSubscription() : null;
    if (!sub) return;
    const json = sub.toJSON();
    try {
      await firstValueFrom(
        this.http.request('delete', `${this.api.baseUrl}/devices`, {
          body: {
            type: 'WEB',
            endpoint: json.endpoint,
            keys: { p256dh: json.keys?.['p256dh'], auth: json.keys?.['auth'] },
          },
        }),
      );
    } catch {
      // Best-effort — even if the server call fails, drop the local sub.
    }
    await sub.unsubscribe();
  }

  private async registerSw(): Promise<ServiceWorkerRegistration | null> {
    try {
      return await navigator.serviceWorker.register('/sw.js');
    } catch {
      return null;
    }
  }
}

function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}
