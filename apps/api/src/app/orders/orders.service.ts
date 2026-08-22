import { randomBytes, randomInt } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { computeTax } from '@takeaway/utils';
import type { Cart, CartItem, Order, Prisma, Product } from '@prisma/client';

import { FeatureFlagsService } from '../config/feature-flags.service';
import { DeliveryFeeService } from '../delivery/delivery-fee.service';
import { CartService } from '../cart/cart.service';
import { GiftCardsService } from '../gift-cards/gift-cards.service';
import { KitchenLoadService } from '../kitchen/kitchen-load.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { MailService } from '../mail/mail.service';
import { ReceiptPdfService } from '../mail/receipt-pdf.service';
import { ReferralsService } from '../referrals/referrals.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PrismaService } from '../prisma/prisma.service';
import { PromoService } from '../promo/promo.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { CustomerLocationDto, CustomerLocationResultDto } from './dto/customer-location.dto';
import type { AdminOrderDetailDto } from './dto/admin-order-detail.dto';
import type { OrderDto, OrderItemDto, OrderSummaryDto } from './dto/order.dto';

const ORDER_CODE_MAX_ATTEMPTS = 8;
const MIN_SCHEDULED_LEAD_MINUTES = 10;
const MAX_SCHEDULED_LEAD_HOURS = 24;
const CANCELLABLE_STATUSES = new Set<string>(['CREATED', 'PAID', 'ACCEPTED']);
const RECEIPT_RESEND_STATUSES = new Set<string>([
  'PAID',
  'ACCEPTED',
  'IN_PROGRESS',
  'READY',
  'PICKED_UP',
  'OUT_FOR_DELIVERY',
  'DELIVERED',
]);
/** Distance buckets for the "I'm here" geofence, in meters. */
const NEARBY_RADIUS_M = 300;
const HERE_RADIUS_M = 60;
/** Statuses where a location ping still makes sense — terminal states reject. */
const LOCATION_TRACKABLE_STATUSES = new Set<string>([
  'CREATED',
  'PAID',
  'ACCEPTED',
  'IN_PROGRESS',
  'READY',
  'OUT_FOR_DELIVERY',
]);

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
    private readonly mail: MailService,
    private readonly receiptPdf: ReceiptPdfService,
    private readonly giftCards: GiftCardsService,
    private readonly referrals: ReferralsService,
    private readonly kitchen: KitchenLoadService,
    private readonly cart: CartService,
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

    // An item can go on the stop-list between the customer filling their
    // basket and tapping pay. Re-check here, not just on add-to-cart.
    await this.cart.assertNotOnStopList(
      cart.storeId,
      cart.items.map((i) => i.productId),
    );

    const pickupAt = await this.resolvePickupAt(cart, dto);
    // Working hours are edited in admin and were enforced nowhere: a 3am
    // handover used to land straight on the kitchen board.
    await this.kitchen.assertOpenAt(cart.storeId, pickupAt);
    // Capacity applies to ASAP too. Without it a rush simply pushes every
    // quoted ETA out, which is the failure this whole model exists to stop.
    await this.kitchen.assertSlotAvailable(cart.storeId, pickupAt);
    const { prepSeconds, workSeconds } = this.kitchen.timings(cart.items);

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
    const pointsMultiplier = promoResult?.pointsMultiplier ?? 1;

    // Gift card — applied AFTER promo discount and BEFORE delivery fee, so a
    // promo never expands the gift card draw. Validation throws on a bad
    // code so the customer sees a clean 400.
    let giftCardCents = 0;
    let giftCardId: string | null = null;
    let normalizedGiftCode: string | null = null;
    if (dto.giftCardCode) {
      const remainingPayable = Math.max(0, subtotalCents - discountCents);
      const validated = await this.giftCards.validateForOrder({
        code: dto.giftCardCode,
        brandId: cart.store.brandId,
        subtotalCents: remainingPayable,
        currency: cart.store.currency,
      });
      giftCardCents = validated.amountCents;
      giftCardId = validated.giftCardId;
      normalizedGiftCode = dto.giftCardCode.toUpperCase().replace(/[^A-Z0-9]/g, '');
    }

    // Tax is settled before the gift card: a gift card is a way of paying,
    // and paying with one does not make the sale tax-free.
    const { taxCents, totalCents } = computeTax({
      subtotalCents,
      discountCents,
      deliveryFeeCents,
      giftCardCents,
      taxRateBps: cart.store.taxRateBps,
      taxIncludedInPrice: cart.store.taxIncludedInPrice,
    });

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
            prepSeconds,
            workSeconds,
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
            giftCardCode: normalizedGiftCode,
            giftCardCents,
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

        if (giftCardId && giftCardCents > 0) {
          await this.giftCards.applyRedemption(tx, {
            giftCardId,
            orderId: created.id,
            amountCents: giftCardCents,
          });
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

    // Customer-facing push — "order received, awaiting payment".
    void this.notifications.notifyOrderStatus(
      {
        id: order.id,
        userId: order.userId,
        orderCode: order.orderCode,
        storeId: order.storeId,
        fulfillmentType: order.fulfillmentType,
      },
      'CREATED',
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

  /**
   * One order, in full, for the admin detail panel. Scope is enforced the
   * same way the list is: a manager who edits the id in the URL gets a 404,
   * not somebody else's customer.
   */
  async getForAdmin(orderId: string, scopeStoreIds?: string[]): Promise<AdminOrderDetailDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        payments: { orderBy: { createdAt: 'asc' } },
        events: { orderBy: { createdAt: 'asc' } },
        store: { select: { name: true } },
        user: { select: { email: true } },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    if (scopeStoreIds && !scopeStoreIds.includes(order.storeId)) {
      // Deliberately the same error as "no such order" — confirming that an
      // order exists in a store you cannot see is itself a leak.
      throw new NotFoundException('Order not found');
    }

    const paidCents = order.payments
      .filter((p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED')
      .reduce((sum, p) => sum + p.amountCents, 0);
    const refundedCents = order.payments.reduce((sum, p) => sum + p.refundedCents, 0);

    return {
      id: order.id,
      orderCode: order.orderCode,
      status: order.status,
      fulfillmentType: order.fulfillmentType,
      pickupMode: order.pickupMode,
      pickupAt: order.pickupAt.toISOString(),
      createdAt: order.createdAt.toISOString(),
      storeId: order.storeId,
      storeName: order.store?.name ?? '',
      customerName: order.customerName,
      customerPhone: order.customerPhone,
      customerEmail: order.user?.email ?? null,
      notes: order.notes,
      currency: order.currency,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      taxCents: order.taxCents,
      deliveryFeeCents: order.deliveryFeeCents,
      giftCardCents: order.giftCardCents,
      totalCents: order.totalCents,
      couponCode: order.couponCode,
      giftCardCode: order.giftCardCode,
      refundedCents,
      refundableCents: Math.max(0, paidCents - refundedCents),
      items: order.items.map((i) => {
        const snap = (i.productSnapshot as Record<string, unknown> | null) ?? {};
        return {
          id: i.id,
          name: typeof snap['name'] === 'string' ? (snap['name'] as string) : 'Item',
          quantity: i.quantity,
          unitPriceCents: i.unitPriceCents,
          totalCents: i.totalCents,
        };
      }),
      payments: order.payments.map((p) => ({
        id: p.id,
        provider: p.provider,
        status: p.status,
        amountCents: p.amountCents,
        refundedCents: p.refundedCents,
        providerRef: p.providerRef,
        createdAt: p.createdAt.toISOString(),
      })),
      events: order.events.map((e) => ({
        id: e.id,
        type: e.type,
        createdAt: e.createdAt.toISOString(),
        actorId: e.actorId,
        payload: e.payload,
      })),
    };
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
      // Referral bonus — fires once per (referee, referrer) pair on the
      // referee's first paid order. Service no-ops if the user wasn't
      // referred or the row is already REWARDED.
      await this.referrals.grantBonusOnFirstPaidOrder({
        userId: order.userId,
        orderId: order.id,
        tx,
      });
    });
  }

  /**
   * Mail fan-out on a successful PAID transition. Always sends a receipt,
   * and additionally a welcome message when this is the user's first paid
   * order (counted by `Order.status='PAID'` siblings excluding this one).
   *
   * Best-effort — MailService swallows transport errors. Intentionally
   * keyed off Order.id (not Payment.id) so a manual /admin retry path
   * still exercises the same logic if we ever wire one.
   */
  /**
   * Re-send the receipt for an order the customer already paid for. Only
   * orders past CREATED qualify — re-sending a receipt for an unpaid or
   * cancelled order would mislead the customer.
   */
  async resendReceipt(userId: string, orderId: string): Promise<{ ok: true }> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, userId: true, status: true },
    });
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found');
    if (!RECEIPT_RESEND_STATUSES.has(order.status)) {
      throw new BadRequestException(`Cannot resend receipt for order in status ${order.status}`);
    }
    await this.sendPaymentMail(orderId);
    return { ok: true };
  }

  async sendPaymentMail(orderId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
        store: { select: { name: true, taxIncludedInPrice: true } },
        user: { select: { email: true, name: true } },
      },
    });
    if (!order || !order.user.email) return;

    const receipt = {
      orderCode: order.orderCode,
      storeName: order.store?.name ?? '',
      currency: order.currency,
      subtotalCents: order.subtotalCents,
      discountCents: order.discountCents,
      deliveryFeeCents: order.deliveryFeeCents,
      taxCents: order.taxCents,
      taxIncluded: order.store?.taxIncludedInPrice ?? true,
      totalCents: order.totalCents,
      items: order.items.map((i) => {
        const snap = (i.productSnapshot as Record<string, unknown> | null) ?? {};
        const name = typeof snap['name'] === 'string' ? (snap['name'] as string) : 'Item';
        return { name, quantity: i.quantity, totalCents: i.totalCents };
      }),
    };

    // Render PDF asynchronously and attach when available — falls back to
    // HTML-only when the receipt has non-ASCII content (Cyrillic etc.) that
    // pdfkit's bundled Helvetica can't draw. Don't block the email on a
    // PDF failure.
    const pdf = await this.receiptPdf.render({ ...receipt, issuedAt: order.createdAt.toISOString() }).catch(() => null);
    const attachments = pdf
      ? [{ filename: `receipt-${order.orderCode}.pdf`, content: pdf, contentType: 'application/pdf' }]
      : undefined;
    void this.mail.sendOrderReceipt(order.user.email, receipt, attachments);

    // Welcome message — sent once, on the first paid order. We compare to
    // any earlier PAID order for this user (the current one is already
    // PAID at the call site, so we look for siblings).
    const earlier = await this.prisma.order.count({
      where: {
        userId: order.userId,
        status: { in: ['PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY', 'PICKED_UP', 'OUT_FOR_DELIVERY', 'DELIVERED'] },
        id: { not: order.id },
      },
    });
    if (earlier === 0) {
      void this.mail.sendWelcome(order.user.email, order.user.name);
    }
  }

  async cancel(userId: string, orderId: string): Promise<OrderDto> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found');
    if (!CANCELLABLE_STATUSES.has(order.status)) {
      throw new BadRequestException(`Cannot cancel an order in status ${order.status}`);
    }

    // Give back the promo redemption and the gift-card balance in the same
    // transaction as the cancellation. Both were taken at creation, and a
    // cancelled order that keeps holding them costs the customer twice.
    const updated = await this.prisma.$transaction(async (tx) => {
      await this.promo.releaseForOrder(tx, orderId);
      await this.giftCards.releaseForOrder(tx, orderId);

      return tx.order.update({
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

  /**
   * Record a customer-proximity ping. Computes haversine distance to the
   * store, classifies into FAR/NEARBY/HERE, and writes a one-shot
   * `CUSTOMER_NEARBY` / `CUSTOMER_HERE` event when the level escalates.
   * Already-fired levels are silently no-op so the client can ping freely.
   *
   * On HERE we also broadcast a KDS update so the kitchen sees the
   * customer arrived, and Telegram-ping store staff once.
   */
  async recordCustomerLocation(
    userId: string,
    orderId: string,
    dto: CustomerLocationDto,
  ): Promise<CustomerLocationResultDto> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        store: { select: { latitude: true, longitude: true } },
        events: {
          where: { type: { in: ['CUSTOMER_NEARBY', 'CUSTOMER_HERE'] } },
          select: { type: true },
        },
      },
    });
    if (!order || order.userId !== userId) throw new NotFoundException('Order not found');
    if (!LOCATION_TRACKABLE_STATUSES.has(order.status)) {
      throw new BadRequestException(`Cannot report location for order in status ${order.status}`);
    }

    const distanceM = haversineMeters(dto.lat, dto.lng, order.store.latitude, order.store.longitude);
    const level: 'FAR' | 'NEARBY' | 'HERE' =
      dto.iAmHere || distanceM <= HERE_RADIUS_M ? 'HERE' : distanceM <= NEARBY_RADIUS_M ? 'NEARBY' : 'FAR';

    const alreadyHere = order.events.some((e) => e.type === 'CUSTOMER_HERE');
    const alreadyNearby = order.events.some((e) => e.type === 'CUSTOMER_NEARBY');

    let recorded = false;
    if (level === 'HERE' && !alreadyHere) {
      await this.prisma.orderEvent.create({
        data: {
          orderId,
          type: 'CUSTOMER_HERE',
          actorId: userId,
          payload: { distanceM, lat: dto.lat, lng: dto.lng } satisfies Prisma.InputJsonValue,
        },
      });
      recorded = true;
      this.realtime.emitKdsOrderChanged({
        storeId: order.storeId,
        kind: 'updated',
        orderId: order.id,
        order: null,
      });
      void this.notifications.notifyStaffCustomerHere({
        id: order.id,
        userId: order.userId,
        orderCode: order.orderCode,
        storeId: order.storeId,
        fulfillmentType: order.fulfillmentType,
      });
    } else if (level === 'NEARBY' && !alreadyNearby && !alreadyHere) {
      await this.prisma.orderEvent.create({
        data: {
          orderId,
          type: 'CUSTOMER_NEARBY',
          actorId: userId,
          payload: { distanceM, lat: dto.lat, lng: dto.lng } satisfies Prisma.InputJsonValue,
        },
      });
      recorded = true;
      this.realtime.emitKdsOrderChanged({
        storeId: order.storeId,
        kind: 'updated',
        orderId: order.id,
        order: null,
      });
    }

    return { level, distanceM: Math.round(distanceM), recorded };
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  /**
   * When we promise to hand the order over.
   *
   * ASAP is quoted against the store's live queue rather than the value
   * cached on the cart — that number was right when the customer last
   * touched their basket, and four orders may have landed since.
   */
  private async resolvePickupAt(cart: Cart & { items: CartItem[] }, dto: CreateOrderDto): Promise<Date> {
    if (dto.pickupMode === 'ASAP') {
      const { prepSeconds } = this.kitchen.timings(cart.items);
      const quote = await this.kitchen.quote(cart.storeId, prepSeconds);
      return new Date(Date.now() + quote.etaSeconds * 1000);
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
      giftCardCode: order.giftCardCode,
      giftCardCents: order.giftCardCents,
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

/** Great-circle distance in meters between two WGS-84 coords. */
function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}
