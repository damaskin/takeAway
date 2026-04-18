import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { type Socket, io } from 'socket.io-client';

import { TmaAuthStore } from '../auth/tma-auth.store';

export interface OrderStatusEvent {
  orderId: string;
  status: 'CREATED' | 'PAID' | 'ACCEPTED' | 'IN_PROGRESS' | 'READY' | 'PICKED_UP' | 'CANCELLED' | 'EXPIRED';
  etaSeconds: number;
  occurredAt: string;
}

@Injectable({ providedIn: 'root' })
export class RealtimeService implements OnDestroy {
  private readonly authStore = inject(TmaAuthStore);
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

  subscribeToOrder(orderId: string, handler: (e: OrderStatusEvent) => void): () => void {
    this.ensureConnected();
    if (!this.socket) return () => undefined;
    this.socket.emit('order.subscribe', { orderId });
    const onEvent = (e: OrderStatusEvent): void => {
      if (e.orderId === orderId) handler(e);
    };
    this.socket.on('order.statusChanged', onEvent);
    return () => {
      this.socket?.emit('order.unsubscribe', { orderId });
      this.socket?.off('order.statusChanged', onEvent);
    };
  }

  ngOnDestroy(): void {
    this.socket?.disconnect();
    this.socket = null;
  }
}
