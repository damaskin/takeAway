import type { ConfigService } from '@nestjs/config';
import type { PaymentStatus } from '@prisma/client';

import type { CartService } from '../cart/cart.service';
import type { FeatureFlagsService } from '../config/feature-flags.service';
import type { DeliveryFeeService } from '../delivery/delivery-fee.service';
import type { GiftCardsService } from '../gift-cards/gift-cards.service';
import type { KitchenLoadService } from '../kitchen/kitchen-load.service';
import type { LoyaltyService } from '../loyalty/loyalty.service';
import type { MailService } from '../mail/mail.service';
import type { ReceiptPdfService } from '../mail/receipt-pdf.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PaymentHoldsService } from '../payments/agroprombank/payment-holds.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { PromoService } from '../promo/promo.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import type { ReferralsService } from '../referrals/referrals.service';
import { OrdersService, canCustomerCancel, cancelRefusal } from './orders.service';

/**
 * The customer cancels only before the kitchen accepts, and only while no
 * money was charged (owner decision 2026-10-20, item 19). Before, an accepted
 * order could be cancelled and the money it was charged was never given back.
 */

const at = (iso: string) => new Date(iso);

function orderRow(patch: Record<string, unknown> = {}) {
  return {
    id: 'order-1',
    userId: 'user-1',
    storeId: 'store-1',
    orderCode: '1234',
    status: 'CREATED',
    kitchenVisibleAt: at('2026-10-20T09:00:00Z'),
    payments: [{ status: 'REQUIRES_ACTION' as PaymentStatus }],
    ...patch,
  };
}

/** What a cancellation reads back for the customer's order view. */
function cancelledRow(base: ReturnType<typeof orderRow>) {
  return {
    ...base,
    status: 'CANCELLED',
    fulfillmentType: 'PICKUP',
    pickupMode: 'ASAP',
    pickupAt: at('2026-10-20T09:15:00Z'),
    qrToken: 'qr',
    subtotalCents: 4500,
    discountCents: 0,
    taxCents: 0,
    totalCents: 4500,
    currency: 'MDL',
    customerName: null,
    customerPhone: null,
    notes: null,
    couponCode: null,
    giftCardCode: null,
    giftCardCents: 0,
    createdAt: at('2026-10-20T09:00:00Z'),
    acceptedAt: null,
    startedAt: null,
    readyAt: null,
    pickedUpAt: null,
    cancelledAt: at('2026-10-20T09:02:00Z'),
    cancelledBy: 'CUSTOMER',
    cancelReason: null,
    cancelComment: null,
    expiredAt: null,
    readyEstimateAt: null,
    deliveryAddressLine: null,
    deliveryCity: null,
    deliveryLatitude: null,
    deliveryLongitude: null,
    deliveryNotes: null,
    deliveryFeeCents: 0,
    deliveryDistanceM: null,
    riderId: null,
    outForDeliveryAt: null,
    deliveredAt: null,
    items: [],
    store: { name: 'Центр', latitude: 0, longitude: 0, addressLine: null, timezone: 'UTC' },
    payments: [{ status: 'REFUNDED' as PaymentStatus, amountCents: 4500, updatedAt: at('2026-10-20T09:02:00Z') }],
  };
}

function harness(found: ReturnType<typeof orderRow>) {
  const tx = {
    order: {
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      update: jest.fn().mockResolvedValue(cancelledRow(found)),
    },
  };
  const prisma = {
    order: { findUnique: jest.fn().mockResolvedValue(found), findMany: jest.fn().mockResolvedValue([]) },
    $transaction: jest.fn((fn: (t: typeof tx) => unknown) => fn(tx)),
  };
  const release = { releaseForOrder: jest.fn().mockResolvedValue(undefined) };
  const holds = { releaseForOrder: jest.fn().mockResolvedValue({ id: 'pay-1', rawJson: {} }) };
  const realtime = { emitOrderStatusChanged: jest.fn(), emitKdsOrderChanged: jest.fn() };
  const notifications = { notifyStoreTeam: jest.fn().mockResolvedValue(1) };
  const service = new OrdersService(
    prisma as unknown as PrismaService,
    realtime as unknown as RealtimeGateway,
    release as unknown as PromoService,
    release as unknown as LoyaltyService,
    {} as ConfigService,
    notifications as unknown as NotificationsService,
    {} as FeatureFlagsService,
    {} as DeliveryFeeService,
    {} as MailService,
    {} as ReceiptPdfService,
    release as unknown as GiftCardsService,
    {} as ReferralsService,
    {} as KitchenLoadService,
    {} as CartService,
    holds as unknown as PaymentHoldsService,
  );
  return { service, prisma, tx, holds, realtime, notifications };
}

describe('OrdersService.cancel (item 19)', () => {
  it('cancels an order the kitchen has not accepted, releases the hold and tells the kitchen', async () => {
    const { service, tx, holds, realtime, notifications } = harness(orderRow());

    const dto = await service.cancel('user-1', 'order-1');

    expect(dto.status).toBe('CANCELLED');
    expect(dto.canCancel).toBe(false);
    expect(dto).toMatchObject({ cancelledBy: 'CUSTOMER', cancelReason: null, cancelComment: null });
    // Claimed only while still waiting and with nothing captured, so an accept
    // (which captures first) racing it cannot leave charged money behind.
    expect(tx.order.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'order-1',
        status: { in: ['CREATED', 'PAID'] },
        payments: { none: { status: { in: ['SUCCEEDED', 'PARTIALLY_REFUNDED'] } } },
      },
      data: {
        status: 'CANCELLED',
        cancelledAt: expect.any(Date),
        cancelledBy: 'CUSTOMER',
        cancelReason: null,
        cancelComment: null,
      },
    });
    expect(holds.releaseForOrder).toHaveBeenCalledWith('order-1', 'order-cancelled-by-customer');
    expect(realtime.emitKdsOrderChanged).toHaveBeenCalledWith({
      storeId: 'store-1',
      kind: 'removed',
      orderId: 'order-1',
      order: null,
      reason: 'CANCELLED_BY_CUSTOMER',
      orderCode: '1234',
    });
    expect(notifications.notifyStoreTeam).toHaveBeenCalledWith(
      'store-1',
      {
        title: 'Клиент отменил заказ #1234 · Центр',
        body:
          'Он ещё не был принят — готовить не нужно. / ' +
          'The customer cancelled order #1234 before it was accepted; no need to make it.',
        orderId: 'order-1',
      },
      { staff: true, owner: true },
    );
  });

  it('does not bother the kitchen about an order that never reached its board', async () => {
    const { service, notifications } = harness(orderRow({ kitchenVisibleAt: null, payments: [] }));
    await service.cancel('user-1', 'order-1');
    expect(notifications.notifyStoreTeam).not.toHaveBeenCalled();
  });

  it.each([
    ['accepted', orderRow({ status: 'ACCEPTED', payments: [{ status: 'SUCCEEDED' }] }), 'ACCEPTED'],
    ['being made', orderRow({ status: 'IN_PROGRESS' }), 'ACCEPTED'],
    ['already charged at checkout', orderRow({ status: 'PAID', payments: [{ status: 'SUCCEEDED' }] }), 'CHARGED'],
  ] as const)('refuses an order %s with 409 ORDER_NOT_CANCELLABLE', async (_, found, reason) => {
    const { service, tx, holds } = harness(found);
    await expect(service.cancel('user-1', 'order-1')).rejects.toMatchObject({
      status: 409,
      response: { code: 'ORDER_NOT_CANCELLABLE', reason },
    });
    expect(tx.order.updateMany).not.toHaveBeenCalled();
    expect(holds.releaseForOrder).not.toHaveBeenCalled();
  });

  it('says ACCEPTED when the kitchen accepted the order a moment before the cancel landed', async () => {
    const { service, prisma, tx, notifications } = harness(orderRow());
    tx.order.updateMany.mockResolvedValue({ count: 0 });
    prisma.order.findUnique
      .mockResolvedValueOnce(orderRow())
      .mockResolvedValueOnce(orderRow({ status: 'ACCEPTED', payments: [{ status: 'SUCCEEDED' }] }));

    await expect(service.cancel('user-1', 'order-1')).rejects.toMatchObject({
      status: 409,
      response: { code: 'ORDER_NOT_CANCELLABLE', reason: 'ACCEPTED' },
    });
    expect(notifications.notifyStoreTeam).not.toHaveBeenCalled();
  });

  it('keeps refusing an order that is already over the old way', async () => {
    const { service } = harness(orderRow({ status: 'EXPIRED' }));
    await expect(service.cancel('user-1', 'order-1')).rejects.toMatchObject({ status: 400 });
  });

  it("answers 404 for somebody else's order", async () => {
    const { service } = harness(orderRow({ userId: 'user-2' }));
    await expect(service.cancel('user-1', 'order-1')).rejects.toMatchObject({ status: 404 });
  });
});

/**
 * The customer's order screen says who cancelled the order and why (item 7,
 * 2026-11-05): written on the order with the status, so the re-read that
 * follows `order.statusChanged` already carries it.
 */
describe('OrdersService.cancelOrder — who and why', () => {
  const STORE_REJECT = { actorId: 'staff-1', by: 'store' as const, allowedStatuses: new Set(['CREATED', 'PAID']) };

  it("keeps the kitchen's reason and comment on the order and its event", async () => {
    const { service, tx } = harness(orderRow({ status: 'PAID' }));

    await service.cancelOrder(
      { id: 'order-1', status: 'PAID' },
      { ...STORE_REJECT, reason: 'OUT_OF_STOCK', comment: 'Нет овсяного молока' },
    );

    expect(tx.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        data: {
          status: 'CANCELLED',
          cancelledAt: expect.any(Date),
          cancelledBy: 'STORE',
          cancelReason: 'OUT_OF_STOCK',
          cancelComment: 'Нет овсяного молока',
        },
      }),
    );
    expect(tx.order.update.mock.calls[0][0].data.events.create.payload).toEqual({
      from: 'PAID',
      by: 'store',
      reason: 'OUT_OF_STOCK',
      comment: 'Нет овсяного молока',
    });
  });

  it("keeps the bank's message on a declined card off the customer's screen", async () => {
    const { service, tx } = harness(orderRow({ status: 'PAID' }));

    await service.cancelOrder(
      { id: 'order-1', status: 'PAID' },
      { ...STORE_REJECT, reason: 'CARD_DECLINED', bankMessage: 'Insufficient funds' },
    );

    expect(tx.order.updateMany.mock.calls[0][0].data).toMatchObject({
      cancelledBy: 'STORE',
      cancelReason: 'CARD_DECLINED',
      cancelComment: null,
    });
    expect(tx.order.update.mock.calls[0][0].data.events.create.payload).toEqual({
      from: 'PAID',
      by: 'store',
      reason: 'CARD_DECLINED',
      bankMessage: 'Insufficient funds',
    });
  });

  it("shows the customer who cancelled, why and the kitchen's comment", async () => {
    const found = orderRow();
    const { service, tx } = harness(found);
    tx.order.update.mockResolvedValue({
      ...cancelledRow(found),
      cancelledBy: 'STORE',
      cancelReason: 'TOO_BUSY',
      cancelComment: 'Очередь на 40 минут',
    });

    const dto = await service.cancel('user-1', 'order-1');

    expect(dto).toMatchObject({ cancelledBy: 'STORE', cancelReason: 'TOO_BUSY', cancelComment: 'Очередь на 40 минут' });
  });

  it('says nothing about an order cancelled before the reason was kept', async () => {
    const found = orderRow();
    const { service, tx } = harness(found);
    tx.order.update.mockResolvedValue({
      ...cancelledRow(found),
      cancelledBy: null,
      cancelReason: null,
      cancelComment: null,
    });

    const dto = await service.cancel('user-1', 'order-1');

    expect(dto).toMatchObject({ cancelledBy: null, cancelReason: null, cancelComment: null });
  });

  it('tells the order history who cancelled and why', async () => {
    const found = orderRow();
    const { service, prisma } = harness(found);
    prisma.order.findMany.mockResolvedValue([
      {
        ...cancelledRow(found),
        cancelledBy: 'STORE',
        cancelReason: 'CLOSING',
        cancelComment: 'Закрываемся раньше',
        items: [{ quantity: 2 }],
      },
    ]);

    const [summary] = await service.listForUser('user-1', 20, 'HISTORY');

    expect(summary).toMatchObject({ status: 'CANCELLED', cancelledBy: 'STORE', cancelReason: 'CLOSING', itemCount: 2 });
    expect(summary).not.toHaveProperty('cancelComment');
  });
});

describe('Order.canCancel', () => {
  const pay = (...statuses: PaymentStatus[]) => statuses.map((status) => ({ status }));

  it('is true while waiting for the kitchen with a hold, a deferred charge or nothing to pay', () => {
    expect(canCustomerCancel({ status: 'CREATED', payments: pay('REQUIRES_ACTION') })).toBe(true);
    expect(canCustomerCancel({ status: 'CREATED', payments: [] })).toBe(true);
    // A refused card, then a hold: still nothing taken.
    expect(canCustomerCancel({ status: 'CREATED', payments: pay('FAILED', 'REQUIRES_ACTION') })).toBe(true);
  });

  it('is false once money is captured or the kitchen accepted, and for an order that is over', () => {
    expect(canCustomerCancel({ status: 'PAID', payments: pay('SUCCEEDED') })).toBe(false);
    expect(canCustomerCancel({ status: 'ACCEPTED', payments: [] })).toBe(false);
    expect(canCustomerCancel({ status: 'CANCELLED', payments: [] })).toBe(false);
    expect(cancelRefusal({ status: 'PAID', payments: pay('PARTIALLY_REFUNDED') })).toBe('CHARGED');
    expect(cancelRefusal({ status: 'READY', payments: [] })).toBe('ACCEPTED');
    expect(cancelRefusal({ status: 'CANCELLED', payments: [] })).toBeNull();
  });
});
