import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { type Socket, io } from 'socket.io-client';

import { AuthStore } from '../auth/auth.store';

export interface OrderStatusEvent {
  orderId: string;
  status: 'CREATED' | 'PAID' | 'ACCEPTED' | 'IN_PROGRESS' | 'READY' | 'PICKED_UP' | 'CANCELLED' | 'EXPIRED';
  etaSeconds: number;
  occurredAt: string;
}

/**
 * A store started or ended its shift, or was switched on or off. Broadcast
 * to every connected customer: a menu or store list on screen refetches the
 * store instead of trusting this payload, which carries no opening hours.
 */
export interface StoreAvailabilityEvent {
  storeId: string;
  brandId: string;
  acceptingOrders: boolean;
}

@Injectable({ providedIn: 'root' })
export class RealtimeService implements OnDestroy {
  private readonly authStore = inject(AuthStore);
  private socket: Socket | null = null;
  readonly connected = signal(false);

  ensureConnected(): void {
    // A socket still connecting counts: a second call in that window opened a second socket.
    if (this.socket?.connected || this.socket?.active) return;
    const token = this.authStore.accessToken();
    if (!token) return;

    this.socket = io(`${window.location.origin}/ws`, {
      auth: { token },
      transports: ['websocket', 'polling'],
      autoConnect: true,
    });
    this.socket.on('connect', () => this.connected.set(true));
    this.socket.on('disconnect', () => this.connected.set(false));
  }

  subscribeToOrder(orderId: string, handler: (event: OrderStatusEvent) => void): () => void {
    this.ensureConnected();
    if (!this.socket) return () => undefined;

    this.socket.emit('order.subscribe', { orderId });
    const onEvent = (event: OrderStatusEvent): void => {
      if (event.orderId === orderId) handler(event);
    };
    this.socket.on('order.statusChanged', onEvent);

    return () => {
      this.socket?.emit('order.unsubscribe', { orderId });
      this.socket?.off('order.statusChanged', onEvent);
    };
  }

  /**
   * Store open/closed changes, for a signed-in customer — the socket needs a
   * session. Screens that show stores also poll, so a guest is not left out.
   */
  onStoreAvailabilityChanged(handler: (event: StoreAvailabilityEvent) => void): () => void {
    this.ensureConnected();
    const socket = this.socket;
    if (!socket) return () => undefined;
    socket.on('store.availabilityChanged', handler);
    return () => socket.off('store.availabilityChanged', handler);
  }

  ngOnDestroy(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
