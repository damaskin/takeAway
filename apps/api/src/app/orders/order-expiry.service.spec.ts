import { ConfigService } from '@nestjs/config';

import type { GiftCardsService } from '../gift-cards/gift-cards.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PromoService } from '../promo/promo.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
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
  realtime: { emitOrderStatusChanged: jest.Mock; emitKdsOrderChanged: jest.Mock };
  notifications: { notifyOrderStatus: jest.Mock };
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
  const realtime = { emitOrderStatusChanged: jest.fn(), emitKdsOrderChanged: jest.fn() };
  const notifications = { notifyOrderStatus: jest.fn().mockResolvedValue(undefined) };

  const env = opts.env ?? {};
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;

  const service = new OrderExpiryService(
    prisma as unknown as PrismaService,
    config,
    promo as unknown as PromoService,
    giftCards as unknown as GiftCardsService,
    notifications as unknown as NotificationsService,
    realtime as unknown as RealtimeGateway,
  );

  return { service, tx, prisma, promo, giftCards, realtime, notifications };
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
      expect(h.tx.order.update).not.toHaveBeenCalled();
      expect(h.realtime.emitOrderStatusChanged).not.toHaveBeenCalled();
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

      const where = h.prisma.order.findMany.mock.calls[0]?.[0]?.where;
      expect(where.status).toBe('CREATED');
      const cutoff = where.createdAt.lt as Date;
      // Twenty minutes back, give or take the time the call took.
      expect(before - cutoff.getTime()).toBeGreaterThanOrEqual(20 * 60_000);
      expect(before - cutoff.getTime()).toBeLessThan(20 * 60_000 + 5_000);
    });

    it('keeps going when one order refuses to expire', async () => {
      const h = harness();
      h.prisma.order.findMany.mockResolvedValue([{ id: 'bad' }, { id: 'good' }]);
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
