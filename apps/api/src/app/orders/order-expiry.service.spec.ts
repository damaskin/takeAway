import { ConfigService } from '@nestjs/config';

import type { GiftCardsService } from '../gift-cards/gift-cards.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PromoService } from '../promo/promo.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import { PaymentHoldsService } from '../payments/agroprombank/payment-holds.service';
import { OrderExpiryService } from './order-expiry.service';

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
  tx: { order: { findUnique: jest.Mock; update: jest.Mock } };
  prisma: { order: { findMany: jest.Mock } };
  promo: { releaseForOrder: jest.Mock };
  giftCards: { releaseForOrder: jest.Mock };
  loyalty: { releaseForOrder: jest.Mock };
  realtime: { emitOrderStatusChanged: jest.Mock; emitKdsOrderChanged: jest.Mock };
  notifications: { notifyOrderStatus: jest.Mock };
  holds: { releaseForOrder: jest.Mock; findHold: jest.Mock };
}

function harness(opts: { env?: Record<string, string>; current?: Record<string, unknown> | null } = {}): Harness {
  const current = opts.current === undefined ? orderRow() : opts.current;

  const tx = {
    order: {
      findUnique: jest.fn().mockResolvedValue(current),
      update: jest.fn().mockResolvedValue(orderRow({ status: 'EXPIRED' })),
    },
    promoRedemption: { deleteMany: jest.fn() },
    giftCardRedemption: { findUnique: jest.fn() },
  };

  const prisma = {
    order: { findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((fn: (t: unknown) => unknown) => Promise.resolve(fn(tx))),
  };

  const promo = { releaseForOrder: jest.fn().mockResolvedValue(undefined) };
  const giftCards = { releaseForOrder: jest.fn().mockResolvedValue(undefined) };
  const loyalty = { releaseForOrder: jest.fn().mockResolvedValue(undefined) };
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
  );

  return { service, tx, prisma, promo, giftCards, loyalty, realtime, notifications, holds };
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
    });

    it('records why the order died, not just that it did', async () => {
      const h = harness();
      await h.service.expire('order-1');

      const data = h.tx.order.update.mock.calls[0]?.[0]?.data;
      expect(data.status).toBe('EXPIRED');
      expect(data.expiredAt).toBeInstanceOf(Date);
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
      );
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
      expect(cardBranch.payments).toEqual({ some: {} });
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

    it('says why each order went: an unfinished payment or a kitchen that never took it', async () => {
      const h = harness();
      h.prisma.order.findMany.mockResolvedValue([
        { id: 'card', _count: { payments: 1 } },
        { id: 'counter', _count: { payments: 0 } },
      ]);
      const expire = jest.spyOn(h.service, 'expire').mockResolvedValue(true);

      await expect(h.service.sweep()).resolves.toBe(2);

      expect(expire).toHaveBeenCalledWith('card', 'payment_timeout');
      expect(expire).toHaveBeenCalledWith('counter', 'not_accepted');
    });

    it('keeps going when one order refuses to expire', async () => {
      const h = harness();
      h.prisma.order.findMany.mockResolvedValue([
        { id: 'bad', _count: { payments: 1 } },
        { id: 'good', _count: { payments: 1 } },
      ]);
      h.tx.order.findUnique.mockRejectedValueOnce(new Error('deadlock')).mockResolvedValue(orderRow({ id: 'good' }));

      await expect(h.service.sweep()).resolves.toBe(1);
    });

    it('takes a bounded batch rather than the whole table', async () => {
      const h = harness();
      await h.service.sweep();
      expect(h.prisma.order.findMany.mock.calls[0]?.[0]?.take).toBe(200);
    });
  });
});
