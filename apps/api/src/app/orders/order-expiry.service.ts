import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus, Prisma } from '@prisma/client';

import { GiftCardsService } from '../gift-cards/gift-cards.service';
import { LoyaltyService } from '../loyalty/loyalty.service';
import { NotificationsService } from '../notifications/notifications.service';
import { PaymentHoldsService } from '../payments/agroprombank/payment-holds.service';
import { isDeferredCharge } from '../payments/card-providers';
import { PrismaService } from '../prisma/prisma.service';
import { PromoService } from '../promo/promo.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

/** How long an order may sit unpaid before we let it go. */
const DEFAULT_TTL_MINUTES = 15;
/** Guardrail so a typo in the env cannot expire orders the moment they land. */
const MIN_TTL_MINUTES = 5;
/** Orders released per sweep. Keeps one bad night from locking the table. */
const BATCH_SIZE = 200;
/** A pay-on-pickup order the kitchen never took is let go this long after its promised time. */
const UNACCEPTED_GRACE_MINUTES = 60;
/** A held (paid-for) order the kitchen has not accepted is let go after this long. */
const DEFAULT_ACCEPT_TTL_MINUTES = 30;
/** …and, for a scheduled order, no earlier than this long past its pickup time. */
const DEFAULT_ACCEPT_GRACE_MINUTES = 15;

type ExpiryReason = 'payment_timeout' | 'not_accepted';

/**
 * Releases orders that were created but never paid for.
 *
 * `EXPIRED` existed in the status enum from the start with nothing to set
 * it, so abandoned checkouts accumulated forever — and they were not inert.
 * Each one held a promo redemption against the customer's per-user limit,
 * held money drawn off a gift card, and occupied a slot the kitchen could
 * have sold to somebody who would actually turn up.
 *
 * Everything reserved at creation is handed back here, in one transaction
 * per order so a failure on one cannot half-release another.
 */
@Injectable()
export class OrderExpiryService {
  private readonly logger = new Logger(OrderExpiryService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly promo: PromoService,
    private readonly giftCards: GiftCardsService,
    private readonly loyalty: LoyaltyService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly holds: PaymentHoldsService,
  ) {}

  get ttlMinutes(): number {
    const raw = Number(this.config.get('ORDER_PAYMENT_TTL_MINUTES'));
    if (!Number.isFinite(raw) || raw <= 0) return DEFAULT_TTL_MINUTES;
    return Math.max(MIN_TTL_MINUTES, Math.floor(raw));
  }

  /**
   * How long a paid-for (held) order may wait for the kitchen to accept it
   * (`ORDER_ACCEPT_TTL_MINUTES`). Counted from the moment the hold landed.
   */
  get acceptTtlMinutes(): number {
    return this.minutes('ORDER_ACCEPT_TTL_MINUTES', DEFAULT_ACCEPT_TTL_MINUTES);
  }

  /**
   * A scheduled order is the kitchen's to accept up to its pickup time, plus
   * this much (`ORDER_ACCEPT_GRACE_MINUTES`): a pre-order for the morning
   * placed the night before is not abandoned at 23:30.
   */
  get acceptGraceMinutes(): number {
    return this.minutes('ORDER_ACCEPT_GRACE_MINUTES', DEFAULT_ACCEPT_GRACE_MINUTES);
  }

  /**
   * Every minute rather than every five: the point is to free the pickup
   * slot, and a slot released four minutes late is a slot somebody else
   * could not book. One indexed query when there is nothing to do.
   */
  @Cron(CronExpression.EVERY_MINUTE, { name: 'order-payment-expiry' })
  async sweep(): Promise<number> {
    const now = Date.now();
    const cutoff = new Date(now - this.ttlMinutes * 60_000);
    const pickupCutoff = new Date(now - UNACCEPTED_GRACE_MINUTES * 60_000);
    const heldCutoff = new Date(now - this.acceptTtlMinutes * 60_000);
    const heldPickupCutoff = new Date(now - this.acceptGraceMinutes * 60_000);

    const stale = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.CREATED,
        OR: [
          // A card payment was started and never went through. Measured from
          // the latest attempt as well as from the order: a customer who is
          // still on the bank's payment page is not expired under them.
          {
            payments: {
              some: {},
              none: { OR: [{ status: 'REQUIRES_ACTION' }, { createdAt: { gte: cutoff } }] },
            },
            createdAt: { lt: cutoff },
          },
          // Paying on pickup there is nothing to wait for: CREATED only means
          // "the kitchen has not taken it yet", hours ahead for a scheduled
          // order. The payment timeout used to expire these after fifteen
          // minutes — every pre-order for the morning died overnight. Only an
          // order the kitchen never took, well past its time, is let go.
          { payments: { none: {} }, pickupAt: { lt: pickupCutoff } },
          // Paid for — the amount is held on the card — and the kitchen never
          // accepted it: after its own window, and for a scheduled order not
          // before its pickup time has come and gone. The hold is released.
          {
            payments: { some: { status: 'REQUIRES_ACTION', updatedAt: { lt: heldCutoff } } },
            pickupAt: { lt: heldPickupCutoff },
          },
        ],
      },
      select: {
        id: true,
        _count: { select: { payments: true } },
        payments: { where: { status: 'REQUIRES_ACTION' }, select: { id: true }, take: 1 },
      },
      take: BATCH_SIZE,
      orderBy: { createdAt: 'asc' },
    });
    if (stale.length === 0) return 0;

    let released = 0;
    for (const { id, _count, payments } of stale) {
      try {
        const reason: ExpiryReason =
          payments.length > 0 ? 'not_accepted' : _count.payments > 0 ? 'payment_timeout' : 'not_accepted';
        await this.expire(id, reason);
        released += 1;
      } catch (err) {
        // One wedged order must not stop the sweep — the next tick retries.
        this.logger.error(`Could not expire order ${id}: ${String(err)}`);
      }
    }

    this.logger.log(`Expired ${released} order(s) left unpaid or never taken by the kitchen`);
    return released;
  }

  private minutes(key: string, fallback: number): number {
    const raw = Number(this.config.get(key));
    if (!Number.isFinite(raw) || raw <= 0) return fallback;
    return Math.max(MIN_TTL_MINUTES, Math.floor(raw));
  }

  /**
   * Expire one order and give back everything it was holding.
   *
   * The order is claimed first, with an update that only matches while it
   * is still CREATED. A payment can land between the sweep's query and this
   * call, and that customer must keep their coffee; and two sweepers (two
   * API instances, or the old and new container during a deploy) used to
   * both read CREATED and both hand back the promo, the gift-card balance
   * and the points — twice the money back. Now exactly one claim wins and
   * the others match nothing.
   */
  async expire(orderId: string, reason: ExpiryReason = 'payment_timeout'): Promise<boolean> {
    const expired = await this.prisma.$transaction(async (tx) => {
      const claimed = await tx.order.updateMany({
        where: { id: orderId, status: OrderStatus.CREATED },
        data: { status: OrderStatus.EXPIRED, expiredAt: new Date() },
      });
      if (claimed.count === 0) return null;

      await this.promo.releaseForOrder(tx, orderId);
      await this.giftCards.releaseForOrder(tx, orderId);
      await this.loyalty.releaseForOrder(tx, orderId);

      return tx.order.update({
        where: { id: orderId },
        data: {
          events: {
            create: {
              type: 'STATUS_CHANGED',
              payload: {
                from: OrderStatus.CREATED,
                to: OrderStatus.EXPIRED,
                reason,
                ...(reason === 'payment_timeout'
                  ? { ttlMinutes: this.ttlMinutes }
                  : {
                      graceMinutes: UNACCEPTED_GRACE_MINUTES,
                      acceptTtlMinutes: this.acceptTtlMinutes,
                      acceptGraceMinutes: this.acceptGraceMinutes,
                    }),
              } satisfies Prisma.InputJsonValue,
            },
          },
        },
        select: { id: true, userId: true, storeId: true, status: true, orderCode: true, fulfillmentType: true },
      });
    });

    if (!expired) return false;

    // An order the store never took on must not keep the customer's money
    // frozen. The bank call cannot join the transaction above, so it runs here
    // and reports rather than throws — see PaymentHoldsService.
    const released = await this.holds.releaseForOrder(orderId, 'order-expired');

    this.realtime.emitOrderStatusChanged(
      {
        orderId: expired.id,
        status: expired.status,
        etaSeconds: 0,
        occurredAt: new Date().toISOString(),
      },
      expired.userId,
    );
    // Drop it off the kitchen board — CREATED orders are shown there.
    this.realtime.emitKdsOrderChanged({
      storeId: expired.storeId,
      kind: 'removed',
      orderId: expired.id,
      order: null,
    });
    void this.notifications.notifyOrderStatus(expired, OrderStatus.EXPIRED, {
      expiry: {
        reason,
        holdReleased: released !== null && !isDeferredCharge(released),
        notCharged: released !== null && isDeferredCharge(released),
      },
    });

    return true;
  }
}
