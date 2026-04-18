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

  private orderRoom(orderId: string): string {
    return `order:${orderId}`;
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
