import { randomBytes, randomInt } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Cart, CartItem, Order, Prisma, Product } from '@prisma/client';

import { FeatureFlagsService } from '../config/feature-flags.service';
import { DeliveryFeeService } from '../delivery/delivery-fee.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PromoService } from '../promo/promo.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { OrderDto, OrderItemDto, OrderSummaryDto } from './dto/order.dto';

const ORDER_CODE_MAX_ATTEMPTS = 8;
const MIN_SCHEDULED_LEAD_MINUTES = 10;
const MAX_SCHEDULED_LEAD_HOURS = 24;
const CANCELLABLE_STATUSES = new Set<string>(['CREATED', 'PAID', 'ACCEPTED']);

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly promo: PromoService,
    private readonly loyalty: LoyaltyService,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly flags: FeatureFlagsService,
    private readonly deliveryFee: DeliveryFeeService,
  ) {}

  async create(userId: string, dto: CreateOrderDto): Promise<OrderDto> {
    const cart = await this.prisma.cart.findUnique({
      where: { id: dto.cartId },
      include: { items: { include: { product: true } }, store: true },
    });
    if (!cart) throw new NotFoundException('Cart not found');
    if (cart.userId !== userId) throw new ForbiddenException('Cart does not belong to the current user');
    if (cart.items.length === 0) throw new BadRequestException('Cart is empty');

    const fulfillmentType = dto.fulfillmentType ?? 'PICKUP';

    // Validate delivery payload BEFORE pricing so a missing address returns
    // a clean 400 instead of half-creating an order.
    if (fulfillmentType === 'DELIVERY') {
      // Hard gate: even if a store has DELIVERY in its fulfillmentTypes
      // (legacy seed data), refuse new orders while the module is off. The
      // catalog layer already strips DELIVERY from public responses, so a
      // client should never see the UI — this guard catches direct API calls.
      if (!this.flags.deliveryEnabled) {
        throw new BadRequestException('Delivery is not available at this time');
      }
      if (!dto.deliveryAddressLine || !dto.deliveryCity) {
        throw new BadRequestException('deliveryAddressLine and deliveryCity are required for DELIVERY orders');
      }
      // Reject DELIVERY for a store that hasn't opted in.
      if (!cart.store.fulfillmentTypes.includes('DELIVERY')) {
        throw new BadRequestException('This store does not support delivery');
      }
    }

    const pickupAt = this.resolvePickupAt(cart, dto);

    const subtotalCents = cart.items.reduce((sum, i) => sum + i.unitPriceCents * i.quantity, 0);
    if (subtotalCents < cart.store.minOrderCents) {
      throw new BadRequestException('Cart total below store minimum');
    }

    // Delivery fee — distance-based when the client sends customer coords,
    // flat fallback otherwise (see DeliveryFeeService).
    let deliveryFeeCents = 0;
    let deliveryDistanceM: number | null = null;
    if (fulfillmentType === 'DELIVERY') {
      const quote = this.deliveryFee.quote({
        storeLatitude: cart.store.latitude,
        storeLongitude: cart.store.longitude,
        customerLatitude: dto.deliveryLatitude ?? null,
        customerLongitude: dto.deliveryLongitude ?? null,
        storeOverrides: {
          deliveryFeeBaseCents: cart.store.deliveryFeeBaseCents,
          deliveryFeePerKmCents: cart.store.deliveryFeePerKmCents,
          deliveryFreeRadiusM: cart.store.deliveryFreeRadiusM,
          deliveryMaxRadiusM: cart.store.deliveryMaxRadiusM,
        },
      });
      if (!quote.deliverable) {
        throw new BadRequestException('Delivery address is outside the serviceable radius');
      }
      deliveryFeeCents = quote.feeCents;
      deliveryDistanceM = quote.distanceM;
    }

    // Resolve promo (if any) BEFORE the transaction — validation is cheap and
    // catching a bad code here keeps our transaction tight. Discounts get
    // locked in via applyAndRedeem() inside the tx below.
    const promoResult = dto.couponCode
      ? await this.promo.validate(userId, dto.couponCode, cart.store.brandId, subtotalCents)
      : null;
    if (promoResult && !promoResult.valid) {
      throw new BadRequestException(promoResult.reason ?? 'Promo code invalid');
    }

    const discountCents = promoResult?.discountCents ?? 0;
    const taxCents = 0;
    const totalCents = Math.max(0, subtotalCents - discountCents + taxCents + deliveryFeeCents);
    const pointsMultiplier = promoResult?.pointsMultiplier ?? 1;

    const order = await this.withUniqueOrderCode((orderCode) =>
      this.prisma.$transaction(async (tx) => {
        const created = await tx.order.create({
          data: {
            userId,
            storeId: cart.storeId,
            status: 'CREATED',
            fulfillmentType,
            pickupMode: dto.pickupMode,
            pickupAt,
            subtotalCents,
            discountCents,
            taxCents,
            totalCents,
            currency: cart.store.currency,
            orderCode,
            qrToken: randomBytes(16).toString('hex'),
            customerName: dto.customerName,
            customerPhone: dto.customerPhone,
            notes: dto.notes,
            couponCode: dto.couponCode,
            // Delivery bits — nullable / 0 when the order is PICKUP.
            deliveryAddressLine: dto.deliveryAddressLine ?? null,
            deliveryCity: dto.deliveryCity ?? null,
            deliveryLatitude: dto.deliveryLatitude ?? null,
            deliveryLongitude: dto.deliveryLongitude ?? null,
            deliveryNotes: dto.deliveryNotes ?? null,
            deliveryFeeCents,
            deliveryDistanceM,
            items: {
              create: cart.items.map((i) => ({
                productSnapshot: this.snapshotItem(i) as Prisma.InputJsonValue,
                quantity: i.quantity,
                unitPriceCents: i.unitPriceCents,
                totalCents: i.unitPriceCents * i.quantity,
              })),
            },
            events: {
              create: {
                type: 'STATUS_CHANGED',
                actorId: userId,
                payload: { to: 'CREATED' } satisfies Prisma.InputJsonValue,
              },
            },
          },
          include: { items: true, store: true },
        });

        // Record promo redemption in the same transaction so cart conversion,
        // promo use and points multiplier are all-or-nothing.
        if (dto.couponCode && promoResult?.valid) {
          await this.promo.applyAndRedeem(
            {
              code: dto.couponCode,
              brandId: cart.store.brandId,
              subtotalCents,
              userId,
            },
            created.id,
            tx,
          );
        }

        await tx.cartItem.deleteMany({ where: { cartId: cart.id } });
        await tx.cart.update({
          where: { id: cart.id },
          data: { subtotalCents: 0, etaSeconds: 0 },
        });

        // Stash the effective multiplier in the order payload for later
        // points credit (we do it on PAID transition in PaymentsService).
        await tx.orderEvent.create({
          data: {
            orderId: created.id,
            type: 'NOTE',
            actorId: userId,
            payload: { pointsMultiplier } satisfies Prisma.InputJsonValue,
          },
        });

        return created;
      }),
    );

    return this.toOrderDto(order);
  }

  async getForUser(userId: string, orderId: string): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true, store: { select: { name: true } } },
    });
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found');
    return this.toOrderDto(order);
  }

  async listForUser(
    userId: string,
    take = 20,
    statusGroup: 'ACTIVE' | 'HISTORY' | 'ALL' = 'ALL',
  ): Promise<OrderSummaryDto[]> {
    const activeStatuses = ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY'] as const;
    const historyStatuses = ['PICKED_UP', 'CANCELLED', 'EXPIRED'] as const;
    const where: Prisma.OrderWhereInput = { userId };
    if (statusGroup === 'ACTIVE') where.status = { in: [...activeStatuses] };
    if (statusGroup === 'HISTORY') where.status = { in: [...historyStatuses] };

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(100, Math.max(1, take)),
      include: { items: { select: { quantity: true } }, store: { select: { name: true } } },
    });
    return orders.map((o) => this.toSummary(o));
  }

  /**
   * Admin feed — brand-wide list with optional status / store filters.
   * Roles are enforced in the controller via @Roles(BRAND_ADMIN|SUPER_ADMIN).
   */
  async listForAdmin(params: {
    brandId?: string;
    storeId?: string;
    status?: string;
    take?: number;
    /**
     * Store-level access filter. When provided (STORE_MANAGER etc.), the
     * query is narrowed to this allow-list. If the caller also passed an
     * explicit `storeId` that isn't in the scope, the final filter picks
     * the intersection (empty → no results), so a manager fiddling with
     * ?storeId= in a URL can't see stores they shouldn't.
     */
    scopeStoreIds?: string[];
  }): Promise<OrderSummaryDto[]> {
    const where: Prisma.OrderWhereInput = {};
    if (params.scopeStoreIds) {
      if (params.scopeStoreIds.length === 0) return [];
      if (params.storeId) {
        // Intersect the single requested store with the user's scope.
        if (!params.scopeStoreIds.includes(params.storeId)) return [];
        where.storeId = params.storeId;
      } else {
        where.storeId = { in: params.scopeStoreIds };
      }
    } else if (params.storeId) {
      where.storeId = params.storeId;
    }
    if (params.brandId) where.store = { brandId: params.brandId };
    if (params.status) where.status = params.status as Prisma.OrderWhereInput['status'];

    const orders = await this.prisma.order.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: Math.min(200, Math.max(1, params.take ?? 50)),
      include: { items: { select: { quantity: true } }, store: { select: { name: true } } },
    });
    return orders.map((o) => this.toSummary(o));
  }

  private toSummary(o: {
    id: string;
    orderCode: string;
    status: string;
    pickupMode: string;
    pickupAt: Date;
    totalCents: number;
    currency: string;
    storeId: string;
    store: { name: string };
    items: Array<{ quantity: number }>;
    createdAt: Date;
  }): OrderSummaryDto {
    return {
      id: o.id,
      orderCode: o.orderCode,
      status: o.status as OrderSummaryDto['status'],
      pickupMode: o.pickupMode as OrderSummaryDto['pickupMode'],
      pickupAt: o.pickupAt.toISOString(),
      totalCents: o.totalCents,
      currency: o.currency as OrderSummaryDto['currency'],
      storeId: o.storeId,
      storeName: o.store.name,
      itemCount: o.items.reduce((sum, i) => sum + i.quantity, 0),
      createdAt: o.createdAt.toISOString(),
    };
  }

  /**
   * Called from PaymentsService when Stripe confirms payment. Credits loyalty
   * points inside a dedicated transaction so a points-ledger failure cannot
   * block the order status transition.
   */
  async creditLoyaltyForPayment(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { events: { where: { type: 'NOTE' }, orderBy: { createdAt: 'asc' } } },
    });
    if (!order) return;

    // Use the pointsMultiplier stamped at order creation (from the promo), or 1×.
    const multiplier =
      order.events
        .map((e) => {
          const p = (e.payload as Record<string, unknown> | null) ?? null;
          return p && typeof p['pointsMultiplier'] === 'number' ? (p['pointsMultiplier'] as number) : null;
        })
        .find((x): x is number => typeof x === 'number') ?? 1;

    await this.prisma.$transaction(async (tx) => {
      await this.loyalty.creditForOrder(order.userId, order.id, order.subtotalCents, multiplier, tx);
    });
  }

  async cancel(userId: string, orderId: string): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found');
    if (!CANCELLABLE_STATUSES.has(order.status)) {
      throw new BadRequestException(`Cannot cancel an order in status ${order.status}`);
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        events: {
          create: {
            type: 'CANCELLED',
            actorId: userId,
            payload: { from: order.status } satisfies Prisma.InputJsonValue,
          },
        },
      },
      include: { items: true, store: { select: { name: true } } },
    });

    this.realtime.emitOrderStatusChanged(
      {
        orderId: updated.id,
        status: updated.status,
        etaSeconds: 0,
        occurredAt: (updated.cancelledAt ?? new Date()).toISOString(),
      },
      updated.userId,
    );

    // Fire-and-forget push. If Telegram/APNs/FCM are down this still
    // returns the cancel result cleanly.
    void this.notifications.notifyOrderStatus(
      {
        id: updated.id,
        userId: updated.userId,
        orderCode: updated.orderCode,
        storeId: updated.storeId,
        fulfillmentType: updated.fulfillmentType,
      },
      updated.status,
    );

    return this.toOrderDto(updated);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private resolvePickupAt(
    cart: Cart & { store: { currentEtaSeconds: number }; items: CartItem[] },
    dto: CreateOrderDto,
  ): Date {
    if (dto.pickupMode === 'ASAP') {
      const etaSeconds = cart.etaSeconds > 0 ? cart.etaSeconds : cart.store.currentEtaSeconds;
      return new Date(Date.now() + etaSeconds * 1000);
    }
    if (!dto.pickupAt) {
      throw new BadRequestException('pickupAt is required for SCHEDULED pickup mode');
    }
    const minAt = new Date(Date.now() + MIN_SCHEDULED_LEAD_MINUTES * 60_000);
    const maxAt = new Date(Date.now() + MAX_SCHEDULED_LEAD_HOURS * 60 * 60_000);
    if (dto.pickupAt < minAt || dto.pickupAt > maxAt) {
      throw new BadRequestException(
        `Scheduled pickup must be between ${MIN_SCHEDULED_LEAD_MINUTES} min and ${MAX_SCHEDULED_LEAD_HOURS} h from now`,
      );
    }
    return dto.pickupAt;
  }

  private snapshotItem(item: CartItem & { product: Product }): Record<string, unknown> {
    return {
      id: item.product.id,
      slug: item.product.slug,
      name: item.product.name,
      variationIds: item.variationIds,
      modifiers: item.modifiersJson,
      notes: item.notes,
      unitPrepSeconds: item.unitPrepSeconds,
    };
  }

  private async withUniqueOrderCode<T extends Order>(
    fn: (code: string) => Promise<T>,
  ): Promise<T & { items: Array<unknown>; store?: { name?: string } }> {
    for (let attempt = 0; attempt < ORDER_CODE_MAX_ATTEMPTS; attempt++) {
      const code = String(randomInt(0, 10_000)).padStart(4, '0');
      try {
        return (await fn(code)) as T & { items: Array<unknown>; store?: { name?: string } };
      } catch (err) {
        const isUnique =
          typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'P2002';
        if (!isUnique) throw err;
      }
    }
    throw new ConflictException('Could not allocate a unique order code; please retry');
  }

  private toOrderDto(
    order: Order & {
      items: Array<{
        id: string;
        productSnapshot: unknown;
        quantity: number;
        unitPriceCents: number;
        totalCents: number;
      }>;
      store?: { name?: string | null } | null;
    },
  ): OrderDto {
    return {
      id: order.id,
      orderCode: order.orderCode,
      qrToken: order.qrToken,
      status: order.status,
      pickupMode: order.pickupMode,
      fulfillmentType: order.fulfillmentType,
      pickupAt: order.pickupAt.toISOString(),
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      taxCents: order.taxCents,
      totalCents: order.totalCents,
      currency: order.currency,
      storeId: order.storeId,
      storeName: order.store?.name ?? '',
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      notes: order.notes,
      couponCode: order.couponCode,
      items: order.items.map<OrderItemDto>((i) => ({
        id: i.id,
        productSnapshot: (i.productSnapshot as Record<string, unknown>) ?? {},
        quantity: i.quantity,
        unitPriceCents: i.unitPriceCents,
        totalCents: i.totalCents,
      })),
      createdAt: order.createdAt.toISOString(),
      acceptedAt: order.acceptedAt?.toISOString() ?? null,
      startedAt: order.startedAt?.toISOString() ?? null,
      readyAt: order.readyAt?.toISOString() ?? null,
      pickedUpAt: order.pickedUpAt?.toISOString() ?? null,
      cancelledAt: order.cancelledAt?.toISOString() ?? null,
      expiredAt: order.expiredAt?.toISOString() ?? null,
      deliveryAddressLine: order.deliveryAddressLine,
      deliveryCity: order.deliveryCity,
      deliveryLatitude: order.deliveryLatitude,
      deliveryLongitude: order.deliveryLongitude,
      deliveryNotes: order.deliveryNotes,
      deliveryFeeCents: order.deliveryFeeCents,
      deliveryDistanceM: order.deliveryDistanceM,
      riderId: order.riderId,
      outForDeliveryAt: order.outForDeliveryAt?.toISOString() ?? null,
      deliveredAt: order.deliveredAt?.toISOString() ?? null,
    };
  }
}
