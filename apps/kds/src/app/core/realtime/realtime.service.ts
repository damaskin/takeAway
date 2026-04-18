import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { type Socket, io } from 'socket.io-client';

import { AuthStore } from '../auth/auth.store';

/**
 * KDS realtime client — joins a per-store room on the /ws namespace and
 * surfaces kds.orderChanged events so the board can patch in place instead
 * of polling.
 */
export interface KdsOrderChanged {
  storeId: string;
  kind: 'created' | 'updated' | 'removed';
  orderId: string;
  order: KdsOrder | null;
}

export interface KdsOrder {
  id: string;
  orderCode: string;
  status: 'CREATED' | 'PAID' | 'ACCEPTED' | 'IN_PROGRESS' | 'READY' | 'PICKED_UP' | 'CANCELLED' | 'EXPIRED';
  pickupMode: 'ASAP' | 'SCHEDULED';
  pickupAt: string;
  createdAt: string;
  customerName: string | null;
  notes: string | null;
  items: Array<{ productSnapshot: { name?: string }; quantity: number }>;
}

@Injectable({ providedIn: 'root' })
export class KdsRealtimeService implements OnDestroy {
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
   * Subscribe to a store's kitchen feed. Returns an unsubscribe function the
   * caller must invoke on store-change or component destroy.
   */
  subscribeToStore(storeId: string, handler: (e: KdsOrderChanged) => void): () => void {
    this.ensureConnected();
    if (!this.socket) return () => undefined;
    this.socket.emit('kds.subscribe', { storeId });
    const onEvent = (e: KdsOrderChanged): void => {
      if (e.storeId === storeId) handler(e);
    };
    this.socket.on('kds.orderChanged', onEvent);
    return () => {
      this.socket?.emit('kds.unsubscribe', { storeId });
      this.socket?.off('kds.orderChanged', onEvent);
    };
  }

  ngOnDestroy(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
