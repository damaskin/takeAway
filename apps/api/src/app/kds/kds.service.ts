import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Order, OrderStatus, Prisma } from '@prisma/client';

import {
  NotificationsService,
  type StoreRejectionInfo,
  type StoreRejectReason,
} from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentHoldsService } from '../payments/agroprombank/payment-holds.service';
import { CARD_PROVIDERS, isCardProvider, isDeferredCharge } from '../payments/card-providers';
import { CardPaymentsService } from '../payments/card-payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const OPEN_STATUSES: OrderStatus[] = ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS', 'READY'];

/** The kitchen can turn an order down until it has accepted it. */
const REJECTABLE_STATUSES: ReadonlySet<string> = new Set<OrderStatus>(['CREATED', 'PAID']);

const ALLOWED_TRANSITIONS: Record<string, OrderStatus[]> = {
  accept: ['CREATED', 'PAID'],
  start: ['ACCEPTED'],
  ready: ['IN_PROGRESS'],
  pickedUp: ['READY'],
};

/** What a board row needs beyond the order itself: its lines and the customer's arrival pings. */
const BOARD_INCLUDE = {
  items: true,
  events: {
    where: { type: { in: ['CUSTOMER_NEARBY', 'CUSTOMER_HERE'] } },
    select: { type: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
} satisfies Prisma.OrderInclude;

type BoardOrder = Prisma.OrderGetPayload<{ include: typeof BOARD_INCLUDE }>;

/**
 * Where the customer is, from the pings their app sends: HERE once they
 * tapped "I'm here" (or walked into the store), NEARBY when they are close.
 * The latest-reached level wins, so HERE is never downgraded.
 */
export function customerArrival(events: readonly { type: string; createdAt: Date }[]): {
  customerArrival: 'NEARBY' | 'HERE' | null;
  customerArrivedAt: string | null;
} {
  const here = events.find((e) => e.type === 'CUSTOMER_HERE');
  if (here) return { customerArrival: 'HERE', customerArrivedAt: here.createdAt.toISOString() };
  const nearby = events.find((e) => e.type === 'CUSTOMER_NEARBY');
  if (nearby) return { customerArrival: 'NEARBY', customerArrivedAt: nearby.createdAt.toISOString() };
  return { customerArrival: null, customerArrivedAt: null };
}

function toBoardRow(o: BoardOrder) {
  return {
    id: o.id,
    orderCode: o.orderCode,
    status: o.status,
    pickupMode: o.pickupMode,
    pickupAt: o.pickupAt.toISOString(),
    createdAt: o.createdAt.toISOString(),
    customerName: o.customerName,
    notes: o.notes,
    ...customerArrival(o.events),
    items: o.items.map((i) => ({
      productSnapshot: i.productSnapshot,
      quantity: i.quantity,
    })),
  };
}

@Injectable()
export class KdsService {
  private readonly logger = new Logger(KdsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
    private readonly cards: CardPaymentsService,
    private readonly holds: PaymentHoldsService,
    private readonly orders: OrdersService,
  ) {}

  async listOpen(storeId: string) {
    const orders = await this.prisma.order.findMany({
      where: { storeId, status: { in: OPEN_STATUSES } },
      orderBy: { pickupAt: 'asc' },
      include: {
        ...BOARD_INCLUDE,
        payments: {
          where: { provider: { in: [...CARD_PROVIDERS] }, status: { in: ['REQUIRES_ACTION', 'SUCCEEDED'] } },
          select: { id: true },
        },
      },
    });

    // A new order the customer has not paid for yet is not the kitchen's
    // business: it shows up once its card hold is in place.
    const payable = orders.filter(
      (o) => o.status !== 'CREATED' || !this.holds.cardPaymentRequired(o) || o.payments.length > 0,
    );
    return payable.map(toBoardRow);
  }

  /**
   * Taking the order on is also the moment the money moves.
   *
   * Under `AGROPROMBANK_HOLD_UNTIL_ACCEPTED` the card was only authorized at
   * checkout, so the capture happens here — before the status flip, because a
   * declined capture must leave the order where it was rather than putting an
   * unpaid ticket on the board. The capture settles the order to PAID on its
   * way through, and this then moves it on to ACCEPTED.
   */
  async accept(storeId: string, orderId: string, staffUserId: string) {
    await this.captureHold(storeId, orderId, staffUserId);
    return this.transition(storeId, orderId, staffUserId, 'accept', {
      status: 'ACCEPTED',
      acceptedAt: new Date(),
    });
  }

  /**
   * Captures whatever is held against the order. A bank refusal surfaces to the
   * staff member as a failed accept — the customer can pay with another
   * card — so the failure is deliberately not swallowed.
   *
   * A charge that was put off until now is different: the customer has long
   * left the checkout and has no way to pay that order again, so a card the
   * bank turns down calls the order off — nothing was taken, and everything it
   * held (promo, gift-card balance, points) goes back — and the customer is
   * told to order again with another card. Only a definitive refusal does
   * that; a bank that did not answer leaves the payment to reconciliation.
   */
  private async captureHold(storeId: string, orderId: string, staffUserId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.storeId !== storeId) throw new NotFoundException('Order not found for this store');
    if (!(ALLOWED_TRANSITIONS['accept'] ?? []).includes(order.status)) return;

    // Nothing is paid at the counter any more: an order that costs money is
    // taken on only with the customer's card behind it.
    if (
      order.status === 'CREATED' &&
      this.holds.cardPaymentRequired(order) &&
      !(await this.holds.hasCardPayment(orderId))
    ) {
      throw new BadRequestException('The customer has not paid for this order yet');
    }

    const hold = await this.holds.findHold(orderId);
    try {
      await this.cards.captureHoldForOrder(orderId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const declined = err instanceof BadRequestException || err instanceof NotFoundException;
      if (hold && isDeferredCharge(hold) && declined) {
        await this.cancelForDeclinedCard(order, staffUserId, message);
        throw new BadRequestException({
          code: 'CARD_DECLINED',
          message: `The customer's card was declined (${message}); the order is cancelled`,
        });
      }
      throw new BadRequestException(`The card could not be charged: ${message}`);
    }
  }

  private async cancelForDeclinedCard(order: Order, staffUserId: string, bankMessage: string): Promise<void> {
    this.logger.warn(`Card declined on accept for order=${order.id}: ${bankMessage} — cancelling the order`);
    const { order: cancelled } = await this.orders.cancelOrder(order, {
      actorId: staffUserId,
      by: 'store',
      allowedStatuses: REJECTABLE_STATUSES,
      reason: 'CARD_DECLINED',
      comment: bankMessage,
    });
    void this.notifications.notifyOrderStatus(
      {
        id: cancelled.id,
        userId: cancelled.userId,
        orderCode: cancelled.orderCode,
        storeId: cancelled.storeId,
        fulfillmentType: cancelled.fulfillmentType,
      },
      'CANCELLED',
      { cardDeclined: true },
    );
  }

  /**
   * The kitchen turns an order down before taking it on: out of something,
   * swamped, closing. The order is cancelled with everything it held handed
   * back — promo, gift-card balance, points — and the money with it: a charge
   * waiting for the accept is called off without touching the card, a hold is
   * released, and a charge already taken is refunded in full. The customer
   * gets a push saying why.
   */
  async reject(
    storeId: string,
    orderId: string,
    staffUserId: string,
    input: { reason: StoreRejectReason; comment?: string },
  ): Promise<{ id: string; status: OrderStatus; orderCode: string; money: StoreRejectionInfo['money'] }> {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.storeId !== storeId) throw new NotFoundException('Order not found for this store');

    const comment = input.comment?.trim() || undefined;
    const {
      order: cancelled,
      holdReleased,
      chargeVoided,
    } = await this.orders.cancelOrder(order, {
      actorId: staffUserId,
      by: 'store',
      allowedStatuses: REJECTABLE_STATUSES,
      reason: input.reason,
      comment,
    });

    let money: StoreRejectionInfo['money'] = chargeVoided ? 'not_charged' : holdReleased ? 'released' : 'none';
    if (!holdReleased && !chargeVoided) {
      const held = cancelled.payments.find((p) => isCardProvider(p.provider) && p.status === 'REQUIRES_ACTION');
      const captured = cancelled.payments.find((p) => isCardProvider(p.provider) && p.status === 'SUCCEEDED');
      if (held) {
        // The bank did not answer; the reconciliation cron keeps trying.
        money = 'pending';
      } else if (captured) {
        try {
          await this.cards.refund(captured, captured.amountCents - captured.refundedCents, {
            actorId: staffUserId,
            reason: 'store-rejected',
            note: comment ?? null,
            source: 'kds',
          });
          money = 'refunded';
        } catch (err) {
          this.logger.error(
            `REFUND NEEDED: order=${orderId} was rejected by the store but the refund failed: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
          money = 'pending';
        }
      }
    }

    void this.notifications.notifyOrderStatus(
      {
        id: cancelled.id,
        userId: cancelled.userId,
        orderCode: cancelled.orderCode,
        storeId: cancelled.storeId,
        fulfillmentType: cancelled.fulfillmentType,
      },
      'CANCELLED',
      { rejection: { reason: input.reason, comment, money } },
    );

    return { id: cancelled.id, status: cancelled.status, orderCode: cancelled.orderCode, money };
  }

  start(storeId: string, orderId: string, staffUserId: string) {
    return this.transition(storeId, orderId, staffUserId, 'start', {
      status: 'IN_PROGRESS',
      startedAt: new Date(),
    });
  }

  ready(storeId: string, orderId: string, staffUserId: string) {
    return this.transition(storeId, orderId, staffUserId, 'ready', {
      status: 'READY',
      readyAt: new Date(),
    });
  }

  pickedUp(storeId: string, orderId: string, staffUserId: string) {
    return this.transition(storeId, orderId, staffUserId, 'pickedUp', {
      status: 'PICKED_UP',
      pickedUpAt: new Date(),
    });
  }

  private async transition(
    storeId: string,
    orderId: string,
    staffUserId: string,
    key: keyof typeof ALLOWED_TRANSITIONS,
    patch: Partial<Order> & { status: OrderStatus },
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order || order.storeId !== storeId) throw new NotFoundException('Order not found for this store');
    // DELIVERY orders never reach PICKED_UP — they move through OUT_FOR_DELIVERY
    // → DELIVERED via the rider flow. Guard in KDS so a barista can't fat-finger
    // the wrong button.
    if (key === 'pickedUp' && order.fulfillmentType === 'DELIVERY') {
      throw new BadRequestException('Delivery orders must be dispatched via the rider flow, not marked picked up');
    }
    const allowed = ALLOWED_TRANSITIONS[key] ?? [];
    if (!allowed.includes(order.status)) {
      throw new BadRequestException(`Cannot ${key} an order in status ${order.status}`);
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data: {
        ...patch,
        events: {
          create: {
            type: 'STATUS_CHANGED',
            actorId: staffUserId,
            payload: { from: order.status, to: patch.status } satisfies Prisma.InputJsonValue,
          },
        },
      },
    });

    this.realtime.emitOrderStatusChanged(
      {
        orderId: updated.id,
        status: updated.status,
        etaSeconds: 0,
        occurredAt: new Date().toISOString(),
      },
      updated.userId,
    );

    // Fire-and-forget: a push failure shouldn't block the kitchen from
    // advancing the order, so we don't await and don't let rejections
    // escape — NotificationsService already swallows provider errors.
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

    // Push to the kitchen board too. PICKED_UP orders leave the open list,
    // so we send a "removed" hint; everything else is an "updated" patch
    // carrying the fresh KDS row so the client can re-render in place.
    if (updated.status === 'PICKED_UP') {
      this.realtime.emitKdsOrderChanged({
        storeId: updated.storeId,
        kind: 'removed',
        orderId: updated.id,
        order: null,
      });
    } else {
      const [row] = await this.listOpenByIds(storeId, [updated.id]);
      this.realtime.emitKdsOrderChanged({
        storeId: updated.storeId,
        kind: 'updated',
        orderId: updated.id,
        order: row ?? null,
      });
    }

    // DELIVERY orders: the dispatcher queue picks them up at READY and drops
    // them at DELIVERED. Mirror the KDS event onto the dispatch channel so
    // managers see new rows appear without a manual refresh.
    if (updated.fulfillmentType === 'DELIVERY' && updated.status === 'READY') {
      this.realtime.emitDispatchChanged({
        storeId: updated.storeId,
        kind: 'created',
        orderId: updated.id,
      });
    }

    return {
      id: updated.id,
      status: updated.status,
      orderCode: updated.orderCode,
      pickupAt: updated.pickupAt.toISOString(),
    };
  }

  /** Same mapping as listOpen() but filtered by specific ids — used to get a
   *  fresh row after a transition so the KDS socket payload is ready-to-paint. */
  private async listOpenByIds(storeId: string, ids: string[]) {
    const orders = await this.prisma.order.findMany({
      where: { storeId, id: { in: ids } },
      include: BOARD_INCLUDE,
    });
    return orders.map(toBoardRow);
  }
}
