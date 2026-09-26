import { Injectable, OnDestroy, inject, signal } from '@angular/core';
import { type Socket, io } from 'socket.io-client';

import { AuthStore } from '../auth/auth.store';
import type { KitchenOrderChanged } from './kitchen-board';

type Handler = (event: KitchenOrderChanged) => void;

/** How long to wait before dialling back in after the server hung up. */
const REDIAL_MS = 5_000;

/**
 * One socket for every kitchen feed the cabinet listens to: the board page
 * and the new-order alerts watch the same stores, and each `watch` call only
 * counts towards a room rather than opening another connection.
 *
 * The API forgets a client's rooms when the connection drops, so they are
 * joined again on every (re)connect. The token is read at each dial, not
 * once: the access token lives fifteen minutes and a board stays open all
 * shift.
 */
@Injectable({ providedIn: 'root' })
export class KitchenRealtimeService implements OnDestroy {
  private readonly authStore = inject(AuthStore);
  private socket: Socket | null = null;
  private readonly rooms = new Map<string, number>();
  private readonly handlers = new Set<Handler>();
  private redial: ReturnType<typeof setTimeout> | null = null;

  readonly connected = signal(false);

  /**
   * Starts delivering `storeId`'s kitchen events to `handler`. Returns the
   * function that stops it; the room is left once nobody watches it.
   */
  watch(storeId: string, handler: Handler): () => void {
    const socket = this.ensureSocket();
    if (!socket) return () => undefined;

    const scoped: Handler = (event) => {
      if (event.storeId === storeId) handler(event);
    };
    this.handlers.add(scoped);
    const count = this.rooms.get(storeId) ?? 0;
    this.rooms.set(storeId, count + 1);
    if (count === 0 && socket.connected) socket.emit('kds.subscribe', { storeId });

    let active = true;
    return () => {
      if (!active) return;
      active = false;
      this.handlers.delete(scoped);
      const left = (this.rooms.get(storeId) ?? 1) - 1;
      if (left > 0) {
        this.rooms.set(storeId, left);
        return;
      }
      this.rooms.delete(storeId);
      if (this.socket?.connected) this.socket.emit('kds.unsubscribe', { storeId });
    };
  }

  /** Drops the connection and every watch — on sign-out. */
  disconnect(): void {
    if (this.redial) clearTimeout(this.redial);
    this.redial = null;
    this.socket?.disconnect();
    this.socket = null;
    this.rooms.clear();
    this.handlers.clear();
    this.connected.set(false);
  }

  ngOnDestroy(): void {
    this.disconnect();
  }

  private ensureSocket(): Socket | null {
    if (this.socket) return this.socket;
    if (!this.authStore.accessToken()) return null;

    const socket = io(`${window.location.origin}/ws`, {
      auth: (cb) => cb({ token: this.authStore.accessToken() ?? '' }),
      transports: ['websocket', 'polling'],
    });
    socket.on('connect', () => {
      this.connected.set(true);
      for (const storeId of this.rooms.keys()) socket.emit('kds.subscribe', { storeId });
    });
    socket.on('disconnect', (reason) => {
      this.connected.set(false);
      // A server-side hang-up (an expired token at handshake, a deploy) is the
      // one case socket.io does not retry by itself.
      if (reason === 'io server disconnect') this.scheduleRedial(socket);
    });
    socket.on('kds.orderChanged', (event: KitchenOrderChanged) => {
      for (const handler of [...this.handlers]) handler(event);
    });
    this.socket = socket;
    return socket;
  }

  private scheduleRedial(socket: Socket): void {
    if (this.redial) return;
    this.redial = setTimeout(() => {
      this.redial = null;
      if (this.socket === socket && this.rooms.size > 0 && this.authStore.accessToken()) socket.connect();
    }, REDIAL_MS);
  }
}
