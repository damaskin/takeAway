import type { KitchenLoadService } from '../kitchen/kitchen-load.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { OpsChatService } from '../notifications/ops-chat.service';
import type { OrderExpiryService } from '../orders/order-expiry.service';
import type { PaymentsService } from '../payments/payments.service';
import type { PrismaService } from '../prisma/prisma.service';
import { KitchenSlaService } from './kitchen-sla.service';

const POLICY = { acceptAlertSeconds: 180, acceptTimeoutSeconds: 480 };
const at = (iso: string) => new Date(iso);
const STORE = { name: 'Кофейня', timezone: 'UTC', kitchenParallelism: 2 };

function harness(rows: unknown[] = []) {
  const prisma = {
    order: {
      findMany: jest.fn().mockResolvedValue(rows),
      // Every claim wins unless a test says otherwise.
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    orderEvent: { create: jest.fn().mockResolvedValue({}) },
  };
  const kitchen = { acceptance: POLICY };
  const notifications = {
    notifyStoreTeam: jest.fn().mockResolvedValue(1),
    notifyOrderDelayed: jest.fn().mockResolvedValue(undefined),
  };
  const opsChat = { enabled: true, send: jest.fn().mockResolvedValue(true) };
  const expiry = { expire: jest.fn().mockResolvedValue(true) };
  const payments = { refundOrder: jest.fn().mockResolvedValue({}) };
  const service = new KitchenSlaService(
    prisma as unknown as PrismaService,
    kitchen as unknown as KitchenLoadService,
    notifications as unknown as NotificationsService,
    opsChat as unknown as OpsChatService,
    expiry as unknown as OrderExpiryService,
    payments as unknown as PaymentsService,
  );
  return { service, prisma, notifications, opsChat, expiry, payments };
}

describe('KitchenSlaService', () => {
  describe('acceptance alert', () => {
    const now = at('2026-10-14T12:03:30Z');
    const waiting = {
      id: 'o-1',
      orderCode: '1234',
      storeId: 'store-1',
      kitchenVisibleAt: at('2026-10-14T12:00:00Z'),
      store: STORE,
    };

    it('tells the staff and the owner once an ASAP order waited 3 minutes', async () => {
      const { service, prisma, notifications } = harness([waiting]);

      await expect(service.alertUnaccepted(now, POLICY)).resolves.toBe(1);

      const where = prisma.order.findMany.mock.calls[0]?.[0]?.where;
      expect(where).toMatchObject({
        status: { in: ['CREATED', 'PAID'] },
        pickupMode: 'ASAP',
        acceptAlertSentAt: null,
        kitchenVisibleAt: { lte: at('2026-10-14T12:00:30Z') },
      });
      expect(prisma.order.updateMany).toHaveBeenCalledWith({
        where: { status: { in: ['CREATED', 'PAID'] }, id: 'o-1', acceptAlertSentAt: null },
        data: { acceptAlertSentAt: now },
      });
      expect(notifications.notifyStoreTeam).toHaveBeenCalledWith(
        'store-1',
        expect.objectContaining({
          title: expect.stringContaining('#1234'),
          body: expect.stringContaining('через 5 мин'),
        }),
        { staff: true, owner: true },
      );
    });

    it('stays quiet when another instance already sent it', async () => {
      const { service, prisma, notifications } = harness([waiting]);
      prisma.order.updateMany.mockResolvedValue({ count: 0 });
      await expect(service.alertUnaccepted(now, POLICY)).resolves.toBe(0);
      expect(notifications.notifyStoreTeam).not.toHaveBeenCalled();
    });
  });

  describe('acceptance timeout', () => {
    const now = at('2026-10-14T12:08:30Z');
    const base = {
      orderCode: '1234',
      storeId: 'store-1',
      store: STORE,
      pickupMode: 'ASAP',
      pickupAt: at('2026-10-14T12:10:00Z'),
    };

    it('looks at ASAP orders 8 minutes on the board and pre-orders 10 minutes before pickup, skipping blocked ones', async () => {
      const { service, prisma } = harness();
      await service.expireUnaccepted(now, POLICY);
      const where = prisma.order.findMany.mock.calls[0]?.[0]?.where;
      expect(where.kitchenVisibleAt).toEqual({ lte: at('2026-10-14T12:00:30Z') });
      expect(where.OR).toEqual([{ pickupMode: 'ASAP' }, { pickupAt: { lte: at('2026-10-14T12:18:30Z') } }]);
      expect(where.events.none.payload).toEqual({ path: ['acceptTimeoutBlocked'], equals: true });
    });

    it('expires a held or deferred order through the expiry path, which releases the money and tells the customer', async () => {
      const { service, expiry, payments } = harness([
        { ...base, id: 'held', status: 'CREATED', payments: [{ provider: 'AGROPROMBANK', status: 'REQUIRES_ACTION' }] },
        { ...base, id: 'free', status: 'CREATED', payments: [] },
      ]);

      await expect(service.expireUnaccepted(now, POLICY)).resolves.toBe(2);

      expect(expiry.expire).toHaveBeenCalledWith('held', 'not_accepted', {
        details: { rule: 'accept_timeout', acceptTimeoutSeconds: 480 },
      });
      expect(expiry.expire).toHaveBeenCalledWith('free', 'not_accepted', expect.anything());
      expect(payments.refundOrder).not.toHaveBeenCalled();
    });

    it('tells the store team and the owner it was called off, with the configured timeout', async () => {
      const { service, notifications } = harness([
        { ...base, id: 'held', status: 'CREATED', payments: [{ provider: 'AGROPROMBANK', status: 'REQUIRES_ACTION' }] },
        {
          ...base,
          id: 'pre',
          orderCode: '5555',
          pickupMode: 'SCHEDULED',
          pickupAt: at('2026-10-14T12:15:00Z'),
          status: 'CREATED',
          payments: [],
        },
      ]);

      await service.expireUnaccepted(now, POLICY);

      expect(notifications.notifyStoreTeam).toHaveBeenCalledWith(
        'store-1',
        {
          title: 'Заказ #1234 отменён автоматически · Кофейня',
          body:
            'Его не приняли за 8 мин. Клиенту ушло уведомление. / ' +
            'It was not accepted within 8 min; the customer was told.',
          orderId: 'held',
        },
        { staff: true, owner: true },
      );
      expect(notifications.notifyStoreTeam).toHaveBeenCalledWith(
        'store-1',
        expect.objectContaining({
          title: 'Заказ #5555 отменён автоматически · Кофейня',
          body: expect.stringContaining('Предзаказ к 12:15 не приняли вовремя'),
        }),
        { staff: true, owner: true },
      );
    });

    it('says nothing when another instance expired the order first', async () => {
      const { service, expiry, notifications } = harness([{ ...base, id: 'free', status: 'CREATED', payments: [] }]);
      expiry.expire.mockResolvedValue(false);
      await expect(service.expireUnaccepted(now, POLICY)).resolves.toBe(0);
      expect(notifications.notifyStoreTeam).not.toHaveBeenCalled();
    });

    it('refunds a captured payment first, then expires the paid order', async () => {
      const { service, expiry, payments } = harness([
        { ...base, id: 'paid', status: 'PAID', payments: [{ provider: 'AGROPROMBANK_WEB', status: 'SUCCEEDED' }] },
      ]);

      await expect(service.expireUnaccepted(now, POLICY)).resolves.toBe(1);

      expect(payments.refundOrder).toHaveBeenCalledWith('paid', expect.objectContaining({ source: 'sla' }));
      expect(expiry.expire).toHaveBeenCalledWith(
        'paid',
        'not_accepted',
        expect.objectContaining({ from: ['PAID'], refunded: true }),
      );
      expect(payments.refundOrder.mock.invocationCallOrder[0]).toBeLessThan(
        expiry.expire.mock.invocationCallOrder[0] ?? 0,
      );
    });

    it('leaves a paid order it cannot refund on the board and tells ops, staff and the owner once', async () => {
      const { service, prisma, expiry, payments, notifications, opsChat } = harness([
        { ...base, id: 'paid', status: 'PAID', payments: [{ provider: 'AGROPROMBANK', status: 'SUCCEEDED' }] },
      ]);
      payments.refundOrder.mockRejectedValue(new Error('The bank refused the refund: not supported'));

      await expect(service.expireUnaccepted(now, POLICY)).resolves.toBe(0);

      expect(expiry.expire).not.toHaveBeenCalled();
      expect(prisma.orderEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          orderId: 'paid',
          type: 'NOTE',
          payload: expect.objectContaining({ acceptTimeoutBlocked: true, reason: 'refund_failed' }),
        }),
      });
      expect(notifications.notifyStoreTeam).toHaveBeenCalledWith('store-1', expect.anything(), {
        staff: true,
        owner: true,
      });
      expect(opsChat.send).toHaveBeenCalledWith(expect.stringContaining('could not be refunded'));
    });

    it('does not cancel an order whose payment is still going through elsewhere', async () => {
      const { service, expiry, prisma } = harness([
        { ...base, id: 'stripe', status: 'CREATED', payments: [{ provider: 'STRIPE', status: 'REQUIRES_ACTION' }] },
      ]);
      await service.expireUnaccepted(now, POLICY);
      expect(expiry.expire).not.toHaveBeenCalled();
      expect(prisma.orderEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ payload: expect.objectContaining({ reason: 'payment_in_flight' }) }),
      });
    });

    it('raises the alarm when the kitchen accepted the order while its refund went through', async () => {
      const { service, expiry, prisma } = harness([
        { ...base, id: 'paid', status: 'PAID', payments: [{ provider: 'STRIPE', status: 'SUCCEEDED' }] },
      ]);
      expiry.expire.mockResolvedValue(false);
      await service.expireUnaccepted(now, POLICY);
      expect(prisma.orderEvent.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ payload: expect.objectContaining({ reason: 'accepted_after_refund' }) }),
      });
    });
  });

  describe('start reminders', () => {
    const preorder = {
      id: 'pre-1',
      orderCode: '4321',
      storeId: 'store-1',
      pickupMode: 'SCHEDULED',
      pickupAt: at('2026-10-14T09:15:00Z'),
      prepSeconds: 180,
      workSeconds: 360,
      kitchenVisibleAt: at('2026-10-14T01:00:00Z'),
    };
    const store = (shiftOpen: boolean) => ({ ...STORE, shifts: shiftOpen ? [{ id: 'shift-1' }] : [] });

    it('waits for the start time of an accepted pre-order, then tells the staff once', async () => {
      const row = { ...preorder, status: 'ACCEPTED', store: store(true) };

      const early = harness([row]);
      await expect(early.service.remindStarts(at('2026-10-14T09:09:00Z'), POLICY)).resolves.toBe(0);

      const { service, notifications } = harness([row]);
      await expect(service.remindStarts(at('2026-10-14T09:10:00Z'), POLICY)).resolves.toBe(1);
      expect(notifications.notifyStoreTeam).toHaveBeenCalledWith(
        'store-1',
        expect.objectContaining({ title: 'Пора готовить предзаказ #4321 к 09:15 · Кофейня' }),
        { staff: true, owner: false },
      );
    });

    it('tells the owner too when no shift is open, and says the store is still closed by its hours', async () => {
      const { service, notifications } = harness([{ ...preorder, status: 'ACCEPTED', store: store(false) }]);
      await service.remindStarts(at('2026-10-14T09:10:00Z'), POLICY);
      expect(notifications.notifyStoreTeam).toHaveBeenCalledWith(
        'store-1',
        expect.objectContaining({ body: expect.stringContaining('Точка ещё закрыта по графику') }),
        { staff: true, owner: true },
      );
    });

    it('reminds about a pre-order nobody accepted in time to accept it before it is called off', async () => {
      const { service, notifications, prisma } = harness([{ ...preorder, status: 'PAID', store: store(true) }]);
      // Called off at 09:05; the reminder comes at 09:00, not at the 09:10 start.
      await expect(service.remindStarts(at('2026-10-14T09:00:00Z'), POLICY)).resolves.toBe(1);
      expect(notifications.notifyStoreTeam).toHaveBeenCalledWith(
        'store-1',
        expect.objectContaining({ body: expect.stringContaining('ещё не принят') }),
        { staff: true, owner: true },
      );
      expect(prisma.order.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ data: { acceptAlertSentAt: at('2026-10-14T09:00:00Z') } }),
      );
    });
  });

  describe('late orders', () => {
    const late = {
      id: 'o-9',
      userId: 'user-1',
      orderCode: '9999',
      storeId: 'store-1',
      fulfillmentType: 'PICKUP',
      pickupAt: at('2026-10-14T16:22:00Z'),
      readyEstimateAt: null,
      lateNotifiedAt: null,
      lateAlertSentAt: null,
      store: STORE,
    };

    it('tells the customer once the promised time passed, and the staff five minutes later', async () => {
      const first = harness([late]);
      await expect(first.service.flagLate(at('2026-10-14T16:23:00Z'))).resolves.toBe(1);
      expect(first.notifications.notifyOrderDelayed).toHaveBeenCalledWith(expect.objectContaining({ id: 'o-9' }));
      expect(first.notifications.notifyStoreTeam).not.toHaveBeenCalled();

      const second = harness([{ ...late, lateNotifiedAt: at('2026-10-14T16:23:00Z') }]);
      await second.service.flagLate(at('2026-10-14T16:27:30Z'));
      expect(second.notifications.notifyOrderDelayed).not.toHaveBeenCalled();
      expect(second.notifications.notifyStoreTeam).toHaveBeenCalledWith(
        'store-1',
        expect.objectContaining({
          title: 'Опаздываем с заказом #9999 · Кофейня',
          body: expect.stringContaining('на 5 мин'),
        }),
        { staff: true, owner: true },
      );
    });

    it('tells the customer only once the new estimate of an order accepted late has passed', async () => {
      const estimated = { ...late, readyEstimateAt: at('2026-10-14T16:26:00Z') };
      const before = harness([estimated]);
      await expect(before.service.flagLate(at('2026-10-14T16:25:00Z'))).resolves.toBe(0);
      expect(before.notifications.notifyOrderDelayed).not.toHaveBeenCalled();

      const after = harness([estimated]);
      await expect(after.service.flagLate(at('2026-10-14T16:26:30Z'))).resolves.toBe(1);
      expect(after.notifications.notifyOrderDelayed).toHaveBeenCalled();
    });

    it('keeps the staff alert five minutes past the original pickup time, estimate or not', async () => {
      const estimated = { ...late, readyEstimateAt: at('2026-10-14T16:40:00Z') };
      const { service, notifications } = harness([estimated]);
      await service.flagLate(at('2026-10-14T16:27:30Z'));
      expect(notifications.notifyOrderDelayed).not.toHaveBeenCalled();
      expect(notifications.notifyStoreTeam).toHaveBeenCalledWith(
        'store-1',
        expect.objectContaining({ title: 'Опаздываем с заказом #9999 · Кофейня' }),
        { staff: true, owner: true },
      );
    });

    it('looks only at orders being made, due within the last two hours', async () => {
      const { service, prisma } = harness();
      await service.flagLate(at('2026-10-14T16:30:00Z'));
      const where = prisma.order.findMany.mock.calls[0]?.[0]?.where;
      expect(where.status).toEqual({ in: ['ACCEPTED', 'IN_PROGRESS'] });
      expect(where.pickupAt).toEqual({ lt: at('2026-10-14T16:30:00Z'), gte: at('2026-10-14T14:30:00Z') });
      // A customer not told yet is a candidate only once their estimate (if any) has passed.
      expect(where.OR[0]).toEqual({
        lateNotifiedAt: null,
        OR: [{ readyEstimateAt: null }, { readyEstimateAt: { lt: at('2026-10-14T16:30:00Z') } }],
      });
    });
  });

  it('keeps going when one check fails', async () => {
    const { service, prisma } = harness();
    prisma.order.findMany.mockRejectedValueOnce(new Error('deadlock')).mockResolvedValue([]);
    await expect(service.sweep(at('2026-10-14T12:00:00Z'))).resolves.toBeUndefined();
    expect(prisma.order.findMany).toHaveBeenCalledTimes(4);
  });
});
