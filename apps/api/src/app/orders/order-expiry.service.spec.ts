import { ConfigService } from '@nestjs/config';

import type { GiftCardsService } from '../gift-cards/gift-cards.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PromoService } from '../promo/promo.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import { PaymentHoldsService } from '../payments/agroprombank/payment-holds.service';
import { OrderExpiryService } from './order-expiry.service';
import type { TakeawayPromoService } from '../takeaway-promos/takeaway-promo.service';

function orderRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: 'order-1',
    userId: 'user-1',
    storeId: 'store-1',
    status: 'CREATED',
    orderCode: '4832',
    fulfillmentType: 'PICKUP',
    ...overrides,
  };
}

interface Harness {
  service: OrderExpiryService;
  tx: { order: { findUnique: jest.Mock; updateMany: jest.Mock; update: jest.Mock } };
  prisma: { order: { findMany: jest.Mock; update: jest.Mock }; store: { findMany: jest.Mock } };
  promo: { releaseForOrder: jest.Mock };
  giftCards: { releaseForOrder: jest.Mock };
  loyalty: { releaseForOrder: jest.Mock };
  realtime: { emitOrderStatusChanged: jest.Mock; emitKdsOrderChanged: jest.Mock };
  notifications: { notifyOrderStatus: jest.Mock };
  holds: { releaseForOrder: jest.Mock; findHold: jest.Mock };
  takeaway: { releaseForOrder: jest.Mock };
}

function harness(
  opts: {
    env?: Record<string, string>;
    current?: Record<string, unknown> | null;
    /** Stores with a held order nobody accepted, for the held-order branches. */
    heldStores?: Array<{ id: string; baseEtaSeconds: number }>;
  } = {},
): Harness {
  const current = opts.current === undefined ? orderRow() : opts.current;

  const tx = {
    order: {
      findUnique: jest.fn().mockResolvedValue(current ? { status: current['status'] } : null),
      // The claim matches the status read just before it.
      updateMany: jest.fn().mockResolvedValue({ count: current ? 1 : 0 }),
      // `payments`: the card hold still on the order when it was claimed, if any.
      update: jest.fn().mockResolvedValue(orderRow({ status: 'EXPIRED', payments: [] })),
    },
    promoRedemption: { deleteMany: jest.fn() },
    giftCardRedemption: { findUnique: jest.fn() },
  };

  const prisma = {
    order: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
    store: { findMany: jest.fn().mockResolvedValue(opts.heldStores ?? []) },
    $transaction: jest.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
  };

  const promo = { releaseForOrder: jest.fn().mockResolvedValue(undefined) };
  const giftCards = { releaseForOrder: jest.fn().mockResolvedValue(undefined) };
  const loyalty = { releaseForOrder: jest.fn().mockResolvedValue(undefined) };
  const takeaway = { releaseForOrder: jest.fn().mockResolvedValue(undefined) };
  const realtime = { emitOrderStatusChanged: jest.fn(), emitKdsOrderChanged: jest.fn() };
  const notifications = { notifyOrderStatus: jest.fn().mockResolvedValue(undefined) };
  const holds = { releaseForOrder: jest.fn().mockResolvedValue(null), findHold: jest.fn().mockResolvedValue(null) };

  const env = opts.env ?? {};
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;

  const service = new OrderExpiryService(
    prisma as unknown as PrismaService,
    config,
    promo as unknown as PromoService,
    giftCards as unknown as GiftCardsService,
    loyalty as unknown as LoyaltyService,
    notifications as unknown as NotificationsService,
    realtime as unknown as RealtimeGateway,
    holds as unknown as PaymentHoldsService,
    takeaway as unknown as TakeawayPromoService,
  );

  return { service, tx, prisma, promo, giftCards, loyalty, realtime, notifications, holds, takeaway };
}

describe('OrderExpiryService', () => {
  describe('ttl', () => {
    it('defaults to 15 minutes', () => {
      expect(harness().service.ttlMinutes).toBe(15);
    });

    it('honours the configured value', () => {
      expect(harness({ env: { ORDER_PAYMENT_TTL_MINUTES: '30' } }).service.ttlMinutes).toBe(30);
    });

    it('clamps a value that would expire orders almost immediately', () => {
      expect(harness({ env: { ORDER_PAYMENT_TTL_MINUTES: '1' } }).service.ttlMinutes).toBe(5);
    });

    it('falls back to the default for junk', () => {
      expect(harness({ env: { ORDER_PAYMENT_TTL_MINUTES: 'soon' } }).service.ttlMinutes).toBe(15);
      expect(harness({ env: { ORDER_PAYMENT_TTL_MINUTES: '-5' } }).service.ttlMinutes).toBe(15);
    });
  });

  describe('expire', () => {
    it('hands back the promo and the gift-card balance', async () => {
      const h = harness();

      await expect(h.service.expire('order-1')).resolves.toBe(true);

      expect(h.promo.releaseForOrder).toHaveBeenCalledWith(expect.anything(), 'order-1');
      expect(h.giftCards.releaseForOrder).toHaveBeenCalledWith(expect.anything(), 'order-1');
      expect(h.loyalty.releaseForOrder).toHaveBeenCalledWith(expect.anything(), 'order-1');
      // A takeAway promo's share of the budget and the welcome bonus too (docs/takeaway-promos.md §2.4).
      expect(h.takeaway.releaseForOrder).toHaveBeenCalledWith(h.tx, 'order-1');
    });

    it('records why the order died, not just that it did', async () => {
      const h = harness();
      await h.service.expire('order-1');

      const claim = h.tx.order.updateMany.mock.calls[0]?.[0];
      expect(claim.where).toEqual({ id: 'order-1', status: 'CREATED' });
      expect(claim.data.status).toBe('EXPIRED');
      expect(claim.data.expiredAt).toBeInstanceOf(Date);
      const data = h.tx.order.update.mock.calls[0]?.[0]?.data;
      expect(data.events.create.payload).toMatchObject({
        from: 'CREATED',
        to: 'EXPIRED',
        reason: 'payment_timeout',
      });
    });

    it('leaves an order alone if payment landed since the sweep read it', async () => {
      const h = harness({ current: orderRow({ status: 'PAID' }) });

      await expect(h.service.expire('order-1')).resolves.toBe(false);

      // Nothing released, nothing announced — that customer keeps their coffee.
      expect(h.promo.releaseForOrder).not.toHaveBeenCalled();
      expect(h.giftCards.releaseForOrder).not.toHaveBeenCalled();
      expect(h.loyalty.releaseForOrder).not.toHaveBeenCalled();
      expect(h.tx.order.update).not.toHaveBeenCalled();
      expect(h.realtime.emitOrderStatusChanged).not.toHaveBeenCalled();
    });

    /**
     * Under the hold-until-accepted policy an abandoned order is sitting on
     * real money. Expiring it without releasing that would leave the customer
     * frozen out of their own funds until the bank's own hold window ran out.
     */
    // Two sweepers at once: only the claim that wins may hand anything back.
    it('hands nothing back when another sweeper already expired the order', async () => {
      const h = harness();
      h.tx.order.updateMany.mockResolvedValue({ count: 0 });

      await expect(h.service.expire('order-1')).resolves.toBe(false);

      expect(h.promo.releaseForOrder).not.toHaveBeenCalled();
      expect(h.giftCards.releaseForOrder).not.toHaveBeenCalled();
      expect(h.loyalty.releaseForOrder).not.toHaveBeenCalled();
      expect(h.takeaway.releaseForOrder).not.toHaveBeenCalled();
      expect(h.tx.order.update).not.toHaveBeenCalled();
    });

    it('releases the money held against an order nobody took on', async () => {
      const h = harness();

      await h.service.expire('order-1');

      expect(h.holds.releaseForOrder).toHaveBeenCalledWith('order-1', 'order-expired');
    });

    it('does not touch the bank for an order that was paid after all', async () => {
      const h = harness({ current: orderRow({ status: 'PAID' }) });

      await h.service.expire('order-1');

      expect(h.holds.releaseForOrder).not.toHaveBeenCalled();
    });

    it('does nothing for an order that no longer exists', async () => {
      const h = harness({ current: null });
      await expect(h.service.expire('gone')).resolves.toBe(false);
    });

    it('tells the customer and clears the kitchen board', async () => {
      const h = harness();
      await h.service.expire('order-1');

      expect(h.realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
        expect.objectContaining({ orderId: 'order-1', status: 'EXPIRED' }),
        'user-1',
      );
      expect(h.realtime.emitKdsOrderChanged).toHaveBeenCalledWith(
        expect.objectContaining({ storeId: 'store-1', kind: 'removed', orderId: 'order-1' }),
      );
      expect(h.notifications.notifyOrderStatus).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'order-1' }),
        'EXPIRED',
        { expiry: { reason: 'payment_timeout', money: null } },
      );
      // Nothing to say about the money: the order keeps no outcome.
      expect(h.prisma.order.update).not.toHaveBeenCalled();
    });

    /**
     * Where the money went is written on the order before anyone is told —
     * the outcome the push states, so the order screen can repeat it
     * (2026-11-09).
     */
    it.each([
      ['a released hold', { id: 'pay-1', rawJson: {} }, 'RELEASED'],
      ['a deferred charge called off', { id: 'pay-1', rawJson: { deferred: true, voided: true } }, 'NOT_CHARGED'],
      ['a hold the bank did not let go of', null, 'PENDING'],
    ] as const)('records %s on the order and says so in the push', async (_, released, money) => {
      const h = harness();
      h.tx.order.update.mockResolvedValue(orderRow({ status: 'EXPIRED', payments: [{ id: 'pay-1' }] }));
      h.holds.releaseForOrder.mockResolvedValue(released);

      await h.service.expire('order-1', 'not_accepted');

      expect(h.prisma.order.update).toHaveBeenCalledWith({ where: { id: 'order-1' }, data: { cancelMoney: money } });
      expect(h.prisma.order.update.mock.invocationCallOrder[0]).toBeLessThan(
        h.realtime.emitOrderStatusChanged.mock.invocationCallOrder[0] ?? 0,
      );
      expect(h.notifications.notifyOrderStatus).toHaveBeenCalledWith(expect.anything(), 'EXPIRED', {
        expiry: { reason: 'not_accepted', money },
      });
    });

    // The acceptance SLA lets a paid order go once its payment was refunded.
    it('expires a paid order when asked to, saying the money is on its way back', async () => {
      const h = harness({ current: orderRow({ status: 'PAID' }) });

      await expect(
        h.service.expire('order-1', 'not_accepted', {
          from: ['PAID'],
          refunded: true,
          details: { rule: 'accept_timeout' },
        }),
      ).resolves.toBe(true);

      expect(h.tx.order.updateMany.mock.calls[0]?.[0]?.where).toEqual({ id: 'order-1', status: 'PAID' });
      expect(h.tx.order.update.mock.calls[0]?.[0]?.data.events.create.payload).toMatchObject({
        from: 'PAID',
        reason: 'not_accepted',
        refunded: true,
        rule: 'accept_timeout',
      });
      expect(h.promo.releaseForOrder).toHaveBeenCalled();
      expect(h.prisma.order.update).toHaveBeenCalledWith({
        where: { id: 'order-1' },
        data: { cancelMoney: 'REFUNDED' },
      });
      expect(h.notifications.notifyOrderStatus).toHaveBeenCalledWith(expect.anything(), 'EXPIRED', {
        expiry: { reason: 'not_accepted', money: 'REFUNDED' },
      });
    });
  });

  describe('sweep', () => {
    it('does no work when nothing is stale', async () => {
      const h = harness();
      await expect(h.service.sweep()).resolves.toBe(0);
      expect(h.promo.releaseForOrder).not.toHaveBeenCalled();
    });

    it('only looks at unpaid orders past the cutoff', async () => {
      const h = harness({ env: { ORDER_PAYMENT_TTL_MINUTES: '20' } });
      const before = Date.now();

      await h.service.sweep();
      const after = Date.now();

      const where = h.prisma.order.findMany.mock.calls[0]?.[0]?.where;
      expect(where.status).toBe('CREATED');
      const [cardBranch] = where.OR;
      // Not an order whose card is held, and not one with a payment attempt
      // still inside the window — the customer may be on the bank's page.
      expect(cardBranch.payments.some).toEqual({});
      expect(cardBranch.payments.none.OR[0]).toEqual({ status: 'REQUIRES_ACTION' });
      expect((cardBranch.payments.none.OR[1].createdAt.gte as Date).getTime()).toBe(cardBranch.createdAt.lt.getTime());
      // The cutoff is twenty minutes behind whenever the sweep ran, which
      // is somewhere in [before, after]. Bracketing both ends keeps this
      // honest without depending on how long the call took.
      const cutoff = (cardBranch.createdAt.lt as Date).getTime();
      expect(cutoff).toBeGreaterThanOrEqual(before - 20 * 60_000);
      expect(cutoff).toBeLessThanOrEqual(after - 20 * 60_000);
    });

    // A pre-order for the morning, paid at the counter, used to die fifteen
    // minutes after it was placed.
    it('leaves a pay-on-pickup order alone until well past its pickup time', async () => {
      const h = harness();
      const before = Date.now();

      await h.service.sweep();

      const where = h.prisma.order.findMany.mock.calls[0]?.[0]?.where;
      const payOnPickup = where.OR[1];
      expect(payOnPickup.payments).toEqual({ none: {} });
      expect(payOnPickup.createdAt).toBeUndefined();
      expect((payOnPickup.pickupAt.lt as Date).getTime()).toBeLessThanOrEqual(before - 60 * 60_000 + 5_000);
    });

    /**
     * A held order is paid for: it gets its own, longer window for the kitchen
     * to accept it, and a scheduled one is never let go before its pickup time
     * has passed.
     */
    it('gives a held order its own acceptance window, past its pickup time', async () => {
      const h = harness({
        env: { ORDER_ACCEPT_TTL_MINUTES: '40', ORDER_ACCEPT_GRACE_MINUTES: '20' },
        heldStores: [{ id: 'store-1', baseEtaSeconds: 600 }],
      });
      const before = Date.now();

      await h.service.sweep();
      const after = Date.now();

      expect(h.prisma.store.findMany).toHaveBeenCalledWith({
        where: { orders: { some: { status: 'CREATED', payments: { some: { status: 'REQUIRES_ACTION' } } } } },
        select: { id: true, baseEtaSeconds: true },
      });
      const where = h.prisma.order.findMany.mock.calls[0]?.[0]?.where;
      const held = where.OR[2];
      expect(held.storeId).toEqual({ in: ['store-1'] });
      expect(held.payments.some.status).toBe('REQUIRES_ACTION');
      const heldCutoff = (held.payments.some.updatedAt.lt as Date).getTime();
      expect(heldCutoff).toBeGreaterThanOrEqual(before - 40 * 60_000);
      expect(heldCutoff).toBeLessThanOrEqual(after - 40 * 60_000);
      const pickupCutoff = (held.pickupAt.lt as Date).getTime();
      expect(pickupCutoff).toBeGreaterThanOrEqual(before - 20 * 60_000);
      expect(pickupCutoff).toBeLessThanOrEqual(after - 20 * 60_000);
    });

    it("never lets a held order go before its store's accept time plus the grace (list 5.0, items 6 and 9)", async () => {
      const h = harness({
        heldStores: [
          { id: 'ten', baseEtaSeconds: 600 },
          { id: 'old', baseEtaSeconds: 0 },
          { id: 'hour', baseEtaSeconds: 3600 },
        ],
      });
      const before = Date.now();

      await h.service.sweep();
      const after = Date.now();

      const held = h.prisma.order.findMany.mock.calls[0]?.[0]?.where.OR.slice(2);
      // 10 minutes (and an older 0, counted as 10) + 15 is under the 30-minute TTL: 30 it stays.
      expect(held.map((b: { storeId: unknown }) => b.storeId)).toEqual([{ in: ['ten', 'old'] }, { in: ['hour'] }]);
      const cutoff = (i: number) => (held[i].payments.some.updatedAt.lt as Date).getTime();
      expect(cutoff(0)).toBeGreaterThanOrEqual(before - 30 * 60_000);
      expect(cutoff(0)).toBeLessThanOrEqual(after - 30 * 60_000);
      // An hour to accept: 60 + 15 minutes.
      expect(cutoff(1)).toBeGreaterThanOrEqual(before - 75 * 60_000);
      expect(cutoff(1)).toBeLessThanOrEqual(after - 75 * 60_000);
    });

    it('has no held branch when no store has a held order waiting', async () => {
      const h = harness();
      await h.service.sweep();
      expect(h.prisma.order.findMany.mock.calls[0]?.[0]?.where.OR).toHaveLength(2);
    });

    it('defaults the acceptance window to 30 minutes and 15 past pickup', () => {
      const h = harness();
      expect(h.service.acceptTtlMinutes).toBe(30);
      expect(h.service.acceptGraceMinutes).toBe(15);
    });

    it('says why each order went: an unfinished payment or a kitchen that never took it', async () => {
      const h = harness();
      h.prisma.order.findMany.mockResolvedValue([
        { id: 'card', _count: { payments: 1 }, payments: [] },
        { id: 'counter', _count: { payments: 0 }, payments: [] },
        { id: 'held', _count: { payments: 1 }, payments: [{ id: 'hold-1' }] },
      ]);
      const expire = jest.spyOn(h.service, 'expire').mockResolvedValue(true);

      await expect(h.service.sweep()).resolves.toBe(3);

      expect(expire).toHaveBeenCalledWith('card', 'payment_timeout');
      expect(expire).toHaveBeenCalledWith('counter', 'not_accepted');
      expect(expire).toHaveBeenCalledWith('held', 'not_accepted');
    });

    it('keeps going when one order refuses to expire', async () => {
      const h = harness();
      h.prisma.order.findMany.mockResolvedValue([
        { id: 'bad', _count: { payments: 1 }, payments: [] },
        { id: 'good', _count: { payments: 1 }, payments: [] },
      ]);
      h.tx.order.updateMany.mockRejectedValueOnce(new Error('deadlock')).mockResolvedValue({ count: 1 });

      await expect(h.service.sweep()).resolves.toBe(1);
    });

    it('takes a bounded batch rather than the whole table', async () => {
      const h = harness();
      await h.service.sweep();
      expect(h.prisma.order.findMany.mock.calls[0]?.[0]?.take).toBe(200);
    });
  });
});
