import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { OrderStatus, type Prisma } from '@prisma/client';

import { KitchenLoadService } from '../kitchen/kitchen-load.service';
import {
  type AcceptancePolicy,
  SCHEDULED_ACCEPT_LEAD_SECONDS,
  acceptAlertAt,
  startBy,
} from '../kitchen/kitchen-timeline';
import { wallClock } from '../kitchen/opening-hours';
import { NotificationsService } from '../notifications/notifications.service';
import { OpsChatService } from '../notifications/ops-chat.service';
import { OrderExpiryService } from '../orders/order-expiry.service';
import { isCardProvider } from '../payments/card-providers';
import { PaymentsService } from '../payments/payments.service';
import { PrismaService } from '../prisma/prisma.service';

const AWAITING: OrderStatus[] = [OrderStatus.CREATED, OrderStatus.PAID];
const BEING_MADE: OrderStatus[] = [OrderStatus.ACCEPTED, OrderStatus.IN_PROGRESS];

/** Orders handled per check and pass — one bad night must not lock the table. */
const BATCH = 100;
/** A late order gets the staff alert once it is this late. */
export const LATE_ALERT_SECONDS = 5 * 60;
/**
 * Reminders and late notices only for orders due this recently: an order
 * from last week nobody marked as handed over must not ping anybody now.
 */
const STALE_AFTER_SECONDS = 2 * 60 * 60;
/** Longest a pre-order's cooking may start before its pickup, for the candidate query. */
const START_LOOKAHEAD_SECONDS = 12 * 60 * 60;

/** Marks an order the timeout could not cancel safely, so it is not retried every minute. */
const BLOCKED_NOTE = 'acceptTimeoutBlocked';

const STORE = { select: { name: true, timezone: true, kitchenParallelism: true } } as const;

type BlockReason = 'payment_in_flight' | 'refund_failed' | 'accepted_after_refund';

/**
 * The kitchen's promises, enforced by the clock (docs/kitchen-policy.md,
 * sections D and E), every minute:
 *
 * - an ASAP order nobody accepted for `ORDER_ACCEPT_ALERT_SECONDS` → a
 *   Telegram alert to the store's staff and the brand owner (once);
 * - still nobody after `ORDER_ACCEPT_TIMEOUT_SECONDS` (a pre-order: not
 *   before 10 minutes ahead of its pickup) → the order expires with reason
 *   `not_accepted` through OrderExpiryService: a hold is released, a charge
 *   waiting for the accept is called off, promo, gift-card balance and
 *   points go back, the customer gets the "not accepted" push. A captured
 *   payment is refunded first; when that fails (or a payment is still in
 *   flight) the order is left alone and ops, staff and the owner are told;
 * - a pre-order whose start time came → «Пора готовить предзаказ» to staff
 *   (once); with no shift open, or the order not accepted yet, also to the
 *   owner;
 * - an accepted order past its pickup time → «Немного задерживаемся» to the
 *   customer (once), and five minutes later an alert to staff and the owner.
 *
 * Each notice is claimed with a conditional update of its own column
 * before it is sent, so two API instances never send it twice.
 */
@Injectable()
export class KitchenSlaService {
  private readonly logger = new Logger(KitchenSlaService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly kitchen: KitchenLoadService,
    private readonly notifications: NotificationsService,
    private readonly opsChat: OpsChatService,
    private readonly expiry: OrderExpiryService,
    private readonly payments: PaymentsService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE, { name: 'kitchen-order-sla' })
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep(new Date());
    } finally {
      this.running = false;
    }
  }

  async sweep(now: Date): Promise<void> {
    const policy = this.kitchen.acceptance;
    const steps: Array<[string, () => Promise<unknown>]> = [
      ['acceptance alerts', () => this.alertUnaccepted(now, policy)],
      ['acceptance timeouts', () => this.expireUnaccepted(now, policy)],
      ['start reminders', () => this.remindStarts(now, policy)],
      ['late orders', () => this.flagLate(now)],
    ];
    for (const [name, step] of steps) {
      try {
        await step();
      } catch (err) {
        // One failing check must not stop the others; the next pass retries.
        this.logger.error(`Kitchen SLA ${name} failed: ${(err as Error).message}`);
      }
    }
  }

  /** ASAP orders waiting for «Принять» past the alert time. Pre-orders are alerted with their start reminder. */
  async alertUnaccepted(now: Date, policy: AcceptancePolicy): Promise<number> {
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: AWAITING },
        pickupMode: 'ASAP',
        kitchenVisibleAt: { lte: new Date(now.getTime() - policy.acceptAlertSeconds * 1000) },
        acceptAlertSentAt: null,
      },
      select: { id: true, orderCode: true, storeId: true, kitchenVisibleAt: true, store: STORE },
      orderBy: { kitchenVisibleAt: 'asc' },
      take: BATCH,
    });

    let sent = 0;
    for (const order of orders) {
      if (!(await this.claim(order.id, 'acceptAlertSentAt', { status: { in: AWAITING } }, now))) continue;
      const visibleAt = order.kitchenVisibleAt ?? now;
      const waiting = Math.max(1, Math.floor((now.getTime() - visibleAt.getTime()) / 60_000));
      const left = Math.max(
        1,
        Math.ceil((visibleAt.getTime() + policy.acceptTimeoutSeconds * 1000 - now.getTime()) / 60_000),
      );
      await this.notifications.notifyStoreTeam(
        order.storeId,
        {
          title: `Заказ #${order.orderCode} ждёт принятия · ${order.store.name}`,
          body:
            `Заказ не принят уже ${waiting} мин. Если его не принять, через ${left} мин он отменится автоматически. / ` +
            `Not accepted for ${waiting} min; it is cancelled automatically in ${left} min unless accepted.`,
          orderId: order.id,
        },
        { staff: true, owner: true },
      );
      sent += 1;
    }
    return sent;
  }

  /** Orders nobody accepted in time: expire them, giving the money back first when it was taken. */
  async expireUnaccepted(now: Date, policy: AcceptancePolicy): Promise<number> {
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: AWAITING },
        kitchenVisibleAt: { lte: new Date(now.getTime() - policy.acceptTimeoutSeconds * 1000) },
        OR: [
          { pickupMode: 'ASAP' },
          { pickupAt: { lte: new Date(now.getTime() + SCHEDULED_ACCEPT_LEAD_SECONDS * 1000) } },
        ],
        events: { none: { type: 'NOTE', payload: { path: [BLOCKED_NOTE], equals: true } } },
      },
      select: {
        id: true,
        status: true,
        orderCode: true,
        storeId: true,
        store: STORE,
        payments: { select: { provider: true, status: true } },
      },
      orderBy: { kitchenVisibleAt: 'asc' },
      take: BATCH,
    });

    let expired = 0;
    const details = { rule: 'accept_timeout', acceptTimeoutSeconds: policy.acceptTimeoutSeconds };
    for (const order of orders) {
      try {
        if (order.status === OrderStatus.CREATED) {
          // A payment of another provider still going through (Stripe) could
          // land after the order is gone — the customer would pay for nothing.
          const inFlight = order.payments.some(
            (p) => !isCardProvider(p.provider) && (p.status === 'PENDING' || p.status === 'REQUIRES_ACTION'),
          );
          if (inFlight) {
            await this.block(order, 'payment_in_flight');
            continue;
          }
          if (await this.expiry.expire(order.id, 'not_accepted', { details })) expired += 1;
          continue;
        }

        // PAID: the money was taken. Give it back first; an order that cannot
        // be refunded automatically stays for a person to sort out.
        const captured = order.payments.some((p) => p.status === 'SUCCEEDED' || p.status === 'PARTIALLY_REFUNDED');
        if (captured) {
          try {
            await this.payments.refundOrder(order.id, {
              reason: 'requested_by_customer',
              note: 'Not accepted by the store in time',
              source: 'sla',
            });
          } catch (err) {
            await this.block(order, 'refund_failed', (err as Error).message);
            continue;
          }
        }
        const done = await this.expiry.expire(order.id, 'not_accepted', {
          from: [OrderStatus.PAID],
          refunded: captured,
          details,
        });
        if (done) expired += 1;
        // The kitchen accepted it while the refund went through: the money
        // is back with the customer, the order is being made.
        else if (captured) await this.block(order, 'accepted_after_refund');
      } catch (err) {
        this.logger.error(`Could not expire unaccepted order ${order.id}: ${(err as Error).message}`);
      }
    }
    if (expired > 0) this.logger.log(`Expired ${expired} order(s) nobody accepted in time`);
    return expired;
  }

  /** «Пора готовить предзаказ»: pre-orders whose start time came and that nobody has started. */
  async remindStarts(now: Date, policy: AcceptancePolicy): Promise<number> {
    const orders = await this.prisma.order.findMany({
      where: {
        pickupMode: 'SCHEDULED',
        status: { in: [OrderStatus.CREATED, OrderStatus.PAID, OrderStatus.ACCEPTED] },
        startReminderSentAt: null,
        pickupAt: {
          gte: new Date(now.getTime() - STALE_AFTER_SECONDS * 1000),
          lte: new Date(now.getTime() + START_LOOKAHEAD_SECONDS * 1000),
        },
        OR: [{ status: OrderStatus.ACCEPTED }, { kitchenVisibleAt: { not: null } }],
      },
      select: {
        id: true,
        status: true,
        orderCode: true,
        storeId: true,
        pickupMode: true,
        pickupAt: true,
        prepSeconds: true,
        workSeconds: true,
        kitchenVisibleAt: true,
        store: {
          select: {
            ...STORE.select,
            shifts: { where: { closedAt: null }, select: { id: true }, take: 1 },
          },
        },
      },
      take: BATCH,
    });

    let sent = 0;
    for (const order of orders) {
      const unaccepted = order.status !== OrderStatus.ACCEPTED;
      const parallelism = order.store.kitchenParallelism;
      const due = unaccepted ? acceptAlertAt(order, parallelism, policy) : startBy(order, parallelism);
      if (!due || due > now) continue;
      if (!(await this.claim(order.id, 'startReminderSentAt', { status: { not: OrderStatus.IN_PROGRESS } }, now))) {
        continue;
      }
      if (unaccepted) await this.claim(order.id, 'acceptAlertSentAt', {}, now);

      const shiftOpen = order.store.shifts.length > 0;
      const time = wallClock(order.pickupAt, order.store.timezone);
      let body: string;
      if (!shiftOpen) {
        body = unaccepted
          ? 'Смена не открыта и заказ не принят — откройте смену и примите его. / The shift is not open and the order is not accepted: open the shift and accept it.'
          : 'Смена не открыта — откройте смену на кухне. / The shift is not open: open it on the kitchen board.';
      } else {
        body = unaccepted
          ? 'Заказ ещё не принят — примите его на кухне и начинайте. / Not accepted yet: accept it on the kitchen board and start.'
          : 'Начинайте, чтобы заказ был готов вовремя. / Start now so it is ready on time.';
      }
      await this.notifications.notifyStoreTeam(
        order.storeId,
        {
          title: `Пора готовить предзаказ #${order.orderCode} к ${time} · ${order.store.name}`,
          body,
          orderId: order.id,
        },
        { staff: true, owner: !shiftOpen || unaccepted },
      );
      sent += 1;
    }
    return sent;
  }

  /** Accepted orders past their pickup time: tell the customer, and five minutes on the staff and owner. */
  async flagLate(now: Date): Promise<number> {
    const lateAlertBefore = new Date(now.getTime() - LATE_ALERT_SECONDS * 1000);
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: BEING_MADE },
        pickupAt: { lt: now, gte: new Date(now.getTime() - STALE_AFTER_SECONDS * 1000) },
        OR: [{ lateNotifiedAt: null }, { lateAlertSentAt: null, pickupAt: { lt: lateAlertBefore } }],
      },
      select: {
        id: true,
        userId: true,
        orderCode: true,
        storeId: true,
        fulfillmentType: true,
        pickupAt: true,
        lateNotifiedAt: true,
        lateAlertSentAt: true,
        store: STORE,
      },
      take: BATCH,
    });

    let flagged = 0;
    for (const order of orders) {
      const stillMaking = { status: { in: BEING_MADE } };
      if (!order.lateNotifiedAt && (await this.claim(order.id, 'lateNotifiedAt', stillMaking, now))) {
        void this.notifications.notifyOrderDelayed(order);
        flagged += 1;
      }
      if (
        !order.lateAlertSentAt &&
        order.pickupAt < lateAlertBefore &&
        (await this.claim(order.id, 'lateAlertSentAt', stillMaking, now))
      ) {
        const late = Math.floor((now.getTime() - order.pickupAt.getTime()) / 60_000);
        const time = wallClock(order.pickupAt, order.store.timezone);
        await this.notifications.notifyStoreTeam(
          order.storeId,
          {
            title: `Опаздываем с заказом #${order.orderCode} · ${order.store.name}`,
            body:
              `Заказ обещан к ${time}, опаздываем на ${late} мин. Клиенту ушло «Немного задерживаемся». / ` +
              `Due at ${time}, ${late} min late. The customer was told it is running late.`,
            orderId: order.id,
          },
          { staff: true, owner: true },
        );
      }
    }
    return flagged;
  }

  /**
   * One-shot marker: the update matches only while the column is still
   * empty (and the order still where the notice makes sense), so exactly
   * one pass of one instance gets to send.
   */
  private async claim(
    orderId: string,
    column: 'acceptAlertSentAt' | 'startReminderSentAt' | 'lateNotifiedAt' | 'lateAlertSentAt',
    where: Prisma.OrderWhereInput,
    now: Date,
  ): Promise<boolean> {
    const claimed = await this.prisma.order.updateMany({
      where: { ...where, id: orderId, [column]: null },
      data: { [column]: now },
    });
    return claimed.count > 0;
  }

  /**
   * The timeout could not let the order go safely. It stays on the board
   * for a person to accept or reject, and ops, staff and the owner hear
   * about it once (the note keeps the next passes off it).
   */
  private async block(
    order: { id: string; orderCode: string; storeId: string; store: { name: string } },
    reason: BlockReason,
    error?: string,
  ): Promise<void> {
    await this.prisma.orderEvent.create({
      data: {
        orderId: order.id,
        type: 'NOTE',
        payload: { [BLOCKED_NOTE]: true, reason, ...(error ? { error } : {}) } satisfies Prisma.InputJsonValue,
      },
    });
    const what: Record<BlockReason, [string, string]> = {
      payment_in_flight: [
        'Оплата ещё проходит, поэтому заказ не отменён автоматически. Примите или отклоните его вручную.',
        'A payment is still going through, so it was not cancelled automatically. Accept or reject it by hand.',
      ],
      refund_failed: [
        'Вернуть оплату автоматически не удалось, поэтому заказ не отменён. Примите его или отклоните и проверьте возврат.',
        'The payment could not be refunded automatically, so it was not cancelled. Accept or reject it and check the refund.',
      ],
      accepted_after_refund: [
        'Деньги клиенту вернули автоматически, но заказ успели принять. Возьмите оплату на месте.',
        'The payment was refunded automatically, but the order was accepted meanwhile. Take the payment at the counter.',
      ],
    };
    const [ru, en] = what[reason];
    const title = `Заказ #${order.orderCode} не принят вовремя · ${order.store.name}`;
    this.logger.error(`Accept timeout of order=${order.id} needs a person (${reason})${error ? `: ${error}` : ''}`);
    await this.notifications.notifyStoreTeam(
      order.storeId,
      { title, body: `${ru} / ${en}`, orderId: order.id },
      { staff: true, owner: true },
    );
    if (this.opsChat.enabled) {
      await this.opsChat.send(`${title}: ${en} (order ${order.id}${error ? `; ${error}` : ''})`);
    }
  }
}
