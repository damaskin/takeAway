import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import type { OrderStatus } from '@prisma/client';
import type { Server, Socket } from 'socket.io';

import { PrismaService } from '../prisma/prisma.service';

interface OrderStatusPayload {
  orderId: string;
  status: OrderStatus;
  etaSeconds: number;
  occurredAt: string;
}

interface StoreLoadPayload {
  storeId: string;
  busyMeter: number;
  currentEtaSeconds: number;
}

/**
 * KDS events. Kitchen clients subscribe to a store room and get any
 * change that should repaint their board (status transition, new order,
 * cancellation). The payload is deliberately identical to what /kds/:storeId
 * GET would return per row so the client just patches in place.
 */
interface KdsOrderPayload {
  storeId: string;
  kind: 'created' | 'updated' | 'removed';
  orderId: string;
  /** Full KDS order row (same shape as KdsService.list). Null for "removed". */
  order: unknown | null;
}

/**
 * Dispatcher events. STORE_MANAGER+ clients subscribe per store. We don't
 * ship the row on the wire — the queue rebuild is cheap and the dispatcher
 * cares about the full, consistent state (rider name, status, etc.). The
 * client refetches `/delivery/queue` on any event.
 */
interface DispatchChangedPayload {
  storeId: string;
  kind: 'created' | 'updated' | 'removed';
  orderId: string;
}

@Injectable()
@WebSocketGateway({ namespace: 'ws', cors: { origin: true, credentials: true } })
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer() private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      client.disconnect(true);
      return;
    }
    try {
      const secret = this.config.get<string>('JWT_ACCESS_SECRET') ?? 'change-me-in-prod-access';
      const payload = await this.jwt.verifyAsync<{ sub: string }>(token, { secret });
      client.data['userId'] = payload.sub;
      client.join(`user:${payload.sub}`);
      this.logger.debug(`WS connected: ${client.id} (user ${payload.sub})`);
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.debug(`WS disconnected: ${client.id}`);
  }

  @SubscribeMessage('order.subscribe')
  async subscribeToOrder(client: Socket, body: { orderId: string }): Promise<{ ok: boolean }> {
    const userId = client.data['userId'] as string | undefined;
    if (!userId || !body?.orderId) return { ok: false };

    const order = await this.prisma.order.findUnique({
      where: { id: body.orderId },
      select: { userId: true },
    });
    if (!order || order.userId !== userId) return { ok: false };

    await client.join(this.orderRoom(body.orderId));
    return { ok: true };
  }

  @SubscribeMessage('order.unsubscribe')
  async unsubscribeFromOrder(client: Socket, body: { orderId: string }): Promise<void> {
    if (!body?.orderId) return;
    await client.leave(this.orderRoom(body.orderId));
  }

  /** Emit order.statusChanged to everyone listening to the order and its owner. */
  emitOrderStatusChanged(payload: OrderStatusPayload, ownerUserId: string): void {
    this.server.to(this.orderRoom(payload.orderId)).emit('order.statusChanged', payload);
    this.server.to(`user:${ownerUserId}`).emit('order.statusChanged', payload);
  }

  /** Emit store-level busy/ETA updates (public channel). */
  emitStoreLoad(payload: StoreLoadPayload): void {
    this.server.emit('store.loadChanged', payload);
  }

  /**
   * KDS clients (store staff) subscribe to their store's kitchen feed. We
   * only let users with a staff-level role in — everyone else gets {ok:false}.
   */
  @SubscribeMessage('kds.subscribe')
  async subscribeToKds(client: Socket, body: { storeId: string }): Promise<{ ok: boolean }> {
    const userId = client.data['userId'] as string | undefined;
    if (!userId || !body?.storeId) return { ok: false };

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || !['STAFF', 'STORE_MANAGER', 'BRAND_ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { ok: false };
    }
    await client.join(this.kdsRoom(body.storeId));
    return { ok: true };
  }

  @SubscribeMessage('kds.unsubscribe')
  async unsubscribeFromKds(client: Socket, body: { storeId: string }): Promise<void> {
    if (!body?.storeId) return;
    await client.leave(this.kdsRoom(body.storeId));
  }

  /**
   * Broadcast a KDS-shaped change to every connected kitchen in this store.
   * Called by OrdersService (new order / cancel) and KdsService (status
   * transitions) to replace the current 5-second polling fallback.
   */
  emitKdsOrderChanged(payload: KdsOrderPayload): void {
    this.server.to(this.kdsRoom(payload.storeId)).emit('kds.orderChanged', payload);
  }

  /**
   * Dispatcher clients (admins + store managers) subscribe to the delivery
   * queue for their store. Only staff-level roles pass — RIDER and CUSTOMER
   * get {ok:false}.
   */
  @SubscribeMessage('dispatch.subscribe')
  async subscribeToDispatch(client: Socket, body: { storeId: string }): Promise<{ ok: boolean }> {
    const userId = client.data['userId'] as string | undefined;
    if (!userId || !body?.storeId) return { ok: false };

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || !['STORE_MANAGER', 'BRAND_ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { ok: false };
    }
    await client.join(this.dispatchRoom(body.storeId));
    return { ok: true };
  }

  @SubscribeMessage('dispatch.unsubscribe')
  async unsubscribeFromDispatch(client: Socket, body: { storeId: string }): Promise<void> {
    if (!body?.storeId) return;
    await client.leave(this.dispatchRoom(body.storeId));
  }

  /** Broadcast a dispatch-queue change to every connected dispatcher for this store. */
  emitDispatchChanged(payload: DispatchChangedPayload): void {
    this.server.to(this.dispatchRoom(payload.storeId)).emit('dispatch.orderChanged', payload);
  }

  private orderRoom(orderId: string): string {
    return `order:${orderId}`;
  }

  private kdsRoom(storeId: string): string {
    return `kds:${storeId}`;
  }

  private dispatchRoom(storeId: string): string {
    return `dispatch:${storeId}`;
  }

  private extractToken(client: Socket): string | null {
    const fromAuth = (client.handshake.auth as { token?: string } | undefined)?.token;
    if (typeof fromAuth === 'string' && fromAuth) return fromAuth;

    const headerValue = client.handshake.headers.authorization;
    if (typeof headerValue === 'string' && headerValue.startsWith('Bearer ')) {
      return headerValue.slice(7);
    }

    const fromQuery = client.handshake.query?.['token'];
    if (typeof fromQuery === 'string' && fromQuery) return fromQuery;

    return null;
  }
}
