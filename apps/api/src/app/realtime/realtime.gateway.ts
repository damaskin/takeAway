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
import type { StoreAvailabilityChangedEvent, StoreAvailabilityChangedEventName } from '@takeaway/shared-types';
import type { Server, Socket } from 'socket.io';

import { UserStoreScopeService } from '../auth/services/user-store-scope.service';
import { corsOriginCheck } from '../common/http/cors-origins';
import { PrismaService } from '../prisma/prisma.service';

interface OrderStatusPayload {
  orderId: string;
  status: OrderStatus;
  etaSeconds: number;
  occurredAt: string;
}

interface StoreLoadPayload {
  storeId: string;
  /** The kitchen marked the store «Загружены» (status OVERLOADED). */
  busy: boolean;
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

/**
 * The biggest message a client may send. Clients only ever send
 * `{orderId}` / `{storeId}` and a JWT in the handshake; socket.io's default of
 * 1 MB let any socket, signed in or not, make the API buffer and parse a
 * megabyte per message.
 */
export const REALTIME_MAX_MESSAGE_BYTES = 16 * 1024;

/** Anonymous sockets open at once before new ones are turned away (`REALTIME_MAX_ANONYMOUS_SOCKETS`). */
const DEFAULT_MAX_ANONYMOUS_SOCKETS = 5000;
/** How long one anonymous socket may stay before it is recycled (`REALTIME_ANONYMOUS_MAX_AGE_SECONDS`). */
const DEFAULT_ANONYMOUS_MAX_AGE_SECONDS = 30 * 60;

@Injectable()
@WebSocketGateway({
  namespace: 'ws',
  // Only matters for long-polling (browsers do not apply CORS to WebSocket);
  // the same origins as the HTTP API instead of reflecting any.
  cors: { origin: corsOriginCheck(), credentials: true },
  maxHttpBufferSize: REALTIME_MAX_MESSAGE_BYTES,
  // A connection that opened the transport but never joined the namespace
  // is dropped after 10 s rather than socket.io's 45.
  connectTimeout: 10_000,
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);
  private readonly anonymous = new Map<string, ReturnType<typeof setTimeout>>();

  @WebSocketServer() private server!: Server;

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly stores: UserStoreScopeService,
  ) {}

  /**
   * Two kinds of socket connect here:
   *
   *  - Signed in: a valid access token. The socket joins its user room and
   *    may subscribe to order, kitchen and dispatch rooms (each subscribe
   *    handler checks the account again).
   *  - Anonymous: no token at all — a storefront opened without an account.
   *    It joins no room and every subscribe answers `{ok:false}`, so all it
   *    receives are the public broadcasts (`store.loadChanged`,
   *    `store.availabilityChanged`).
   *
   * A token that is present but invalid, expired or belongs to a blocked
   * account is still turned away rather than downgraded to anonymous: the
   * clients read the kick as "refresh the token and reconnect".
   */
  async handleConnection(client: Socket): Promise<void> {
    const token = this.extractToken(client);
    if (!token) {
      this.acceptAnonymous(client);
      return;
    }
    try {
      // RealtimeModule configures JwtService with the access secret.
      const payload = await this.jwt.verifyAsync<{ sub: string; kdsb?: string; kds?: string }>(token);
      // Same rule as the HTTP JWT strategy: a blocked or deleted account's
      // access token is still signed and unexpired for a few minutes, and
      // must not open a socket in that window.
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { blockedAt: true } });
      if (!user || user.blockedAt) {
        client.disconnect(true);
        return;
      }
      // A kitchen PIN session follows the kitchens of its person's stores in
      // the tablet's brand, and nothing else.
      const kitchenBrand = await this.kitchenBrandOf(payload);
      client.data['userId'] = payload.sub;
      if (kitchenBrand) client.data['kdsBrandId'] = kitchenBrand;
      client.join(this.userRoom(payload.sub));
      this.logger.debug(`WS connected: ${client.id} (user ${payload.sub})`);
    } catch {
      client.disconnect(true);
    }
  }

  /**
   * The brand a kitchen PIN token is bound to, or null for a password
   * session. A token from before 2026-10-20 names only its store; the brand
   * is that store's — and a token whose store is gone opens nothing.
   */
  private async kitchenBrandOf(payload: { kdsb?: string; kds?: string }): Promise<string | null> {
    if (typeof payload.kdsb === 'string' && payload.kdsb) return payload.kdsb;
    if (typeof payload.kds !== 'string' || !payload.kds) return null;
    const store = await this.prisma.store.findUnique({ where: { id: payload.kds }, select: { brandId: true } });
    if (!store) throw new Error('Kitchen session ended');
    return store.brandId;
  }

  handleDisconnect(client: Socket): void {
    const timer = this.anonymous.get(client.id);
    if (timer !== undefined) {
      clearTimeout(timer);
      this.anonymous.delete(client.id);
    }
    this.logger.debug(`WS disconnected: ${client.id}`);
  }

  /**
   * Anonymous sockets cost us memory and get nothing private, so they are
   * bounded twice. Past `REALTIME_MAX_ANONYMOUS_SOCKETS` open at once a new
   * one is turned away (nginx already caps sockets per address). And each is
   * recycled after `REALTIME_ANONYMOUS_MAX_AGE_SECONDS` (minus up to a
   * quarter, so sockets opened together do not all come back together) by
   * closing its transport: every socket.io client takes that as a dropped
   * connection and reconnects on its own within a second or two, so the
   * public `store.availabilityChanged` broadcast keeps reaching it — and the
   * apps re-read their stores every minute regardless.
   */
  private acceptAnonymous(client: Socket): void {
    const max = this.positiveSetting('REALTIME_MAX_ANONYMOUS_SOCKETS', DEFAULT_MAX_ANONYMOUS_SOCKETS);
    if (this.anonymous.size >= max) {
      this.logger.warn(`WS anonymous socket refused: ${this.anonymous.size} already open (limit ${max})`);
      client.disconnect(true);
      return;
    }
    const maxAgeMs =
      this.positiveSetting('REALTIME_ANONYMOUS_MAX_AGE_SECONDS', DEFAULT_ANONYMOUS_MAX_AGE_SECONDS) * 1000;
    const timer = setTimeout(
      () => {
        this.anonymous.delete(client.id);
        client.conn?.close();
      },
      Math.round(maxAgeMs * (0.75 + Math.random() * 0.25)),
    );
    timer.unref?.();
    this.anonymous.set(client.id, timer);
    this.logger.debug(`WS connected: ${client.id} (anonymous)`);
  }

  private positiveSetting(key: string, fallback: number): number {
    const raw = Number(this.config.get<string>(key));
    return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
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
    this.server.to(this.userRoom(ownerUserId)).emit('order.statusChanged', payload);
  }

  /**
   * Drops every socket a user has open. Each socket joins the user's room on
   * connect, so this also takes it out of any order room it followed.
   */
  disconnectUser(userId: string): void {
    this.server.in(this.userRoom(userId)).disconnectSockets(true);
  }

  /** Emit store-level busy/ETA updates (public channel). */
  emitStoreLoad(payload: StoreLoadPayload): void {
    this.server.emit('store.loadChanged', payload);
  }

  /**
   * A store started or stopped taking orders. Public: every socket of the
   * namespace gets it, anonymous storefronts included, so a menu left open
   * flips to "closed" (or back) without a reload. The payload is a fixed
   * contract the web, TMA and mobile clients rely on — exactly
   * `{storeId, brandId, acceptingOrders}`, nothing else.
   */
  emitStoreAvailabilityChanged(payload: StoreAvailabilityChangedEvent): void {
    const event: StoreAvailabilityChangedEventName = 'store.availabilityChanged';
    this.server.emit(event, {
      storeId: payload.storeId,
      brandId: payload.brandId,
      acceptingOrders: payload.acceptingOrders,
    });
  }

  /**
   * KDS clients (store staff) subscribe to their store's kitchen feed: a
   * staff-level role *and* a store within the account's scope. The role
   * alone used to be enough, so staff of one brand could watch another's
   * orders — customer names and notes included.
   */
  @SubscribeMessage('kds.subscribe')
  async subscribeToKds(client: Socket, body: { storeId: string }): Promise<{ ok: boolean }> {
    const userId = client.data['userId'] as string | undefined;
    if (!userId || !body?.storeId) return { ok: false };
    const kdsBrandId = client.data['kdsBrandId'] as string | undefined;
    if (kdsBrandId) {
      const works = await this.prisma.userStore.findFirst({
        where: { userId, storeId: body.storeId, store: { brandId: kdsBrandId } },
        select: { storeId: true },
      });
      if (!works) return { ok: false };
    }

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || !['STAFF', 'STORE_MANAGER', 'BRAND_ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { ok: false };
    }
    const scope = await this.stores.getScope(userId, user.role);
    if (scope !== '*' && !scope.includes(body.storeId)) return { ok: false };
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
   * A shift opened or closed at this store. Every kitchen screen and cabinet
   * following the store flips its "Start work" / "Finish work" button.
   */
  emitKdsShiftChanged(payload: { storeId: string; shift: unknown }): void {
    this.server.to(this.kdsRoom(payload.storeId)).emit('kds.shiftChanged', payload);
  }

  /**
   * Dispatcher clients (admins + store managers) subscribe to the delivery
   * queue of a store within their scope. RIDER and CUSTOMER get {ok:false}.
   */
  @SubscribeMessage('dispatch.subscribe')
  async subscribeToDispatch(client: Socket, body: { storeId: string }): Promise<{ ok: boolean }> {
    const userId = client.data['userId'] as string | undefined;
    if (!userId || !body?.storeId) return { ok: false };
    // The delivery queue is not the kitchen board; a PIN session does not follow it.
    if (client.data['kdsBrandId']) return { ok: false };

    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { role: true },
    });
    if (!user || !['STORE_MANAGER', 'BRAND_ADMIN', 'SUPER_ADMIN'].includes(user.role)) {
      return { ok: false };
    }
    // The same store scope as the kitchen feed: the role alone let a manager
    // of one brand follow another brand's delivery queue.
    const scope = await this.stores.getScope(userId, user.role);
    if (scope !== '*' && !scope.includes(body.storeId)) return { ok: false };
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

  private userRoom(userId: string): string {
    return `user:${userId}`;
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
