import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { type Socket, io } from 'socket.io-client';

import { AuthStore } from '../auth/auth.store';

/**
 * Dispatcher realtime client. Subscribes to `dispatch:<storeId>` on the
 * /ws namespace and fires a caller-supplied handler on every change to
 * the delivery queue — the dispatch page refetches on any event.
 *
 * Gated server-side to STORE_MANAGER / BRAND_ADMIN / SUPER_ADMIN.
 */
export interface DispatchOrderChanged {
  storeId: string;
  kind: 'created' | 'updated' | 'removed';
  orderId: string;
}

@Injectable({ providedIn: 'root' })
export class DispatchRealtimeService implements OnDestroy {
  private readonly authStore = inject(AuthStore);
  private socket: Socket | null = null;
  readonly connected = signal(false);

  ensureConnected(): void {
    if (this.socket?.connected) return;
    const token = this.authStore.accessToken();
    if (!token) return;
    this.socket = io(`${window.location.origin}/ws`, {
      auth: { token },
      transports: ['websocket', 'polling'],
    });
    this.socket.on('connect', () => this.connected.set(true));
    this.socket.on('disconnect', () => this.connected.set(false));
  }

  /**
   * Subscribe to a store's dispatcher feed. Returns an unsubscribe function
   * the caller must invoke on store-change or component destroy.
   */
  subscribeToStore(storeId: string, handler: (e: DispatchOrderChanged) => void): () => void {
    this.ensureConnected();
    if (!this.socket) return () => undefined;
    this.socket.emit('dispatch.subscribe', { storeId });
    const onEvent = (e: DispatchOrderChanged): void => {
      if (e.storeId === storeId) handler(e);
    };
    this.socket.on('dispatch.orderChanged', onEvent);
    return () => {
      this.socket?.emit('dispatch.unsubscribe', { storeId });
      this.socket?.off('dispatch.orderChanged', onEvent);
    };
  }

  ngOnDestroy(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
