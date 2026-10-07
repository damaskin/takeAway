import { BadGatewayException, BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { PaymentHoldsService } from '../payments/agroprombank/payment-holds.service';
import { CardPaymentsService } from '../payments/card-payments.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { KdsService } from './kds.service';

/**
 * Accepting an order is the moment money moves under the hold-until-accepted
 * policy, so these cover the two outcomes that matter: the capture runs before
 * the board advances, and a refused capture leaves the order alone.
 */
describe('KdsService.accept', () => {
  const order = {
    id: 'order-1',
    storeId: 'store-1',
    userId: 'user-1',
    orderCode: '4242',
    status: 'CREATED' as const,
    fulfillmentType: 'PICKUP' as const,
    pickupMode: 'ASAP' as const,
    pickupAt: new Date('2026-09-22T10:00:00.000Z'),
    createdAt: new Date('2026-09-22T09:50:00.000Z'),
    customerName: null,
    notes: null,
    items: [],
  };

  let prisma: { order: { findUnique: jest.Mock; update: jest.Mock; findMany: jest.Mock } };
  let payments: { captureHoldForOrder: jest.Mock };
  let holds: { cardPaymentRequired: jest.Mock; hasCardPayment: jest.Mock; findHold: jest.Mock };
  let orders: { cancelOrder: jest.Mock };
  let notifications: { notifyOrderStatus: jest.Mock };
  let service: KdsService;

  beforeEach(async () => {
    prisma = {
      order: {
        findUnique: jest.fn().mockResolvedValue(order),
        update: jest.fn().mockResolvedValue({ ...order, status: 'ACCEPTED' }),
        // The board refresh that follows every transition.
        findMany: jest.fn().mockResolvedValue([]),
      },
    };
    payments = { captureHoldForOrder: jest.fn().mockResolvedValue(null) };
    orders = {
      cancelOrder: jest.fn().mockResolvedValue({
        order: { ...order, status: 'CANCELLED', payments: [] },
        holdReleased: false,
        chargeVoided: false,
      }),
    };
    holds = {
      cardPaymentRequired: jest.fn().mockReturnValue(true),
      hasCardPayment: jest.fn().mockResolvedValue(true),
      findHold: jest.fn().mockResolvedValue(null),
    };

    const module = await Test.createTestingModule({
      providers: [
        KdsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: RealtimeGateway,
          useValue: { emitOrderStatusChanged: jest.fn(), emitKdsOrderChanged: jest.fn() },
        },
        { provide: NotificationsService, useValue: { notifyOrderStatus: jest.fn().mockResolvedValue(undefined) } },
        { provide: CardPaymentsService, useValue: payments },
        { provide: OrdersService, useValue: orders },
        { provide: PaymentHoldsService, useValue: holds },
      ],
    }).compile();

    service = module.get(KdsService);
    notifications = module.get(NotificationsService);
  });

  it('captures the hold before putting the order on the board', async () => {
    await service.accept('store-1', order.id, 'staff-1');

    expect(payments.captureHoldForOrder).toHaveBeenCalledWith(order.id);
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACCEPTED' }) }),
    );
  });

  /**
   * A declined card must not produce an accepted ticket: the kitchen would
   * start making something nobody has paid for.
   */
  it('leaves the order untouched when the bank refuses the capture', async () => {
    payments.captureHoldForOrder.mockRejectedValue(new Error('Недостаточно средств'));

    await expect(service.accept('store-1', order.id, 'staff-1')).rejects.toThrow(BadRequestException);

    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  /**
   * With the charge put off until the accept, the customer has left the
   * checkout long ago and cannot pay that order again — so a declined card
   * calls the order off and tells them, instead of leaving it stuck.
   */
  it('cancels the order and tells the customer when the card is declined on accept', async () => {
    holds.findHold.mockResolvedValue({ id: 'pay-d', rawJson: { deferred: true } });
    payments.captureHoldForOrder.mockRejectedValue(new BadRequestException('Insufficient funds'));

    await expect(service.accept('store-1', order.id, 'staff-1')).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'CARD_DECLINED' }),
    });

    expect(orders.cancelOrder).toHaveBeenCalledWith(
      expect.objectContaining({ id: order.id }),
      expect.objectContaining({ by: 'store', reason: 'CARD_DECLINED' }),
    );
    expect(notifications.notifyOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: order.id }),
      'CANCELLED',
      { cardDeclined: true },
    );
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('keeps the order when the bank did not answer about a deferred charge', async () => {
    holds.findHold.mockResolvedValue({ id: 'pay-d', rawJson: { deferred: true } });
    payments.captureHoldForOrder.mockRejectedValue(new BadGatewayException('The bank did not answer in time'));

    await expect(service.accept('store-1', order.id, 'staff-1')).rejects.toThrow(BadRequestException);

    expect(orders.cancelOrder).not.toHaveBeenCalled();
  });

  it('does not reach for the bank on an order that cannot be accepted anyway', async () => {
    prisma.order.findUnique.mockResolvedValue({ ...order, status: 'READY' });

    await expect(service.accept('store-1', order.id, 'staff-1')).rejects.toThrow(BadRequestException);

    expect(payments.captureHoldForOrder).not.toHaveBeenCalled();
  });

  /** There is no paying at the counter: no card behind the order, no ticket. */
  it('refuses an order the customer has not paid for yet', async () => {
    holds.hasCardPayment.mockResolvedValue(false);

    await expect(service.accept('store-1', order.id, 'staff-1')).rejects.toThrow(
      'The customer has not paid for this order yet',
    );

    expect(payments.captureHoldForOrder).not.toHaveBeenCalled();
    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('takes on an order with nothing to pay without asking for a card', async () => {
    holds.cardPaymentRequired.mockReturnValue(false);
    holds.hasCardPayment.mockResolvedValue(false);

    await service.accept('store-1', order.id, 'staff-1');

    expect(prisma.order.update).toHaveBeenCalled();
  });
});

describe('KdsService.listOpen', () => {
  it('shows the kitchen a new order only once it is paid for or held', async () => {
    const base = {
      storeId: 'store-1',
      orderCode: '1',
      pickupMode: 'ASAP',
      pickupAt: new Date('2026-09-22T10:00:00.000Z'),
      createdAt: new Date('2026-09-22T09:50:00.000Z'),
      customerName: null,
      notes: null,
      items: [],
      events: [],
      totalCents: 3000,
    };
    const prisma = {
      order: {
        findMany: jest.fn().mockResolvedValue([
          { ...base, id: 'unpaid', status: 'CREATED', payments: [] },
          { ...base, id: 'held', status: 'CREATED', payments: [{ id: 'p-1' }] },
          { ...base, id: 'accepted', status: 'ACCEPTED', payments: [] },
        ]),
      },
    };
    const module = await Test.createTestingModule({
      providers: [
        KdsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RealtimeGateway, useValue: {} },
        { provide: NotificationsService, useValue: {} },
        { provide: CardPaymentsService, useValue: {} },
        { provide: OrdersService, useValue: {} },
        { provide: PaymentHoldsService, useValue: { cardPaymentRequired: () => true } },
      ],
    }).compile();

    const rows = await module.get(KdsService).listOpen('store-1');

    expect(rows.map((r) => r.id)).toEqual(['held', 'accepted']);
  });
});

/**
 * The kitchen turning an order down is a cancellation with the money given
 * back — a hold released, or a charge already taken refunded — and a push
 * that tells the customer why.
 */
describe('KdsService.reject', () => {
  const order = { id: 'order-1', storeId: 'store-1', userId: 'user-1', status: 'CREATED' as const };
  const cancelled = {
    ...order,
    status: 'CANCELLED' as const,
    orderCode: '4242',
    fulfillmentType: 'PICKUP' as const,
    payments: [] as Array<Record<string, unknown>>,
  };

  let orders: { cancelOrder: jest.Mock };
  let cards: { refund: jest.Mock };
  let notifications: { notifyOrderStatus: jest.Mock };
  let service: KdsService;

  async function build(found: Record<string, unknown> | null = order): Promise<void> {
    orders = { cancelOrder: jest.fn().mockResolvedValue({ order: cancelled, holdReleased: true }) };
    cards = { refund: jest.fn().mockResolvedValue('rrn-1') };
    notifications = { notifyOrderStatus: jest.fn().mockResolvedValue(undefined) };
    const module = await Test.createTestingModule({
      providers: [
        KdsService,
        { provide: PrismaService, useValue: { order: { findUnique: jest.fn().mockResolvedValue(found) } } },
        { provide: RealtimeGateway, useValue: {} },
        { provide: NotificationsService, useValue: notifications },
        { provide: CardPaymentsService, useValue: cards },
        { provide: PaymentHoldsService, useValue: {} },
        { provide: OrdersService, useValue: orders },
      ],
    }).compile();
    service = module.get(KdsService);
  }

  it('cancels as the store, only before the order is accepted, and tells the customer why', async () => {
    await build();

    const result = await service.reject('store-1', order.id, 'staff-1', {
      reason: 'OUT_OF_STOCK',
      comment: ' Нет молока ',
    });

    const [, options] = orders.cancelOrder.mock.calls[0];
    expect(options).toMatchObject({ actorId: 'staff-1', by: 'store', reason: 'OUT_OF_STOCK', comment: 'Нет молока' });
    expect([...options.allowedStatuses]).toEqual(['CREATED', 'PAID']);
    expect(result).toMatchObject({ status: 'CANCELLED', money: 'released' });
    expect(notifications.notifyOrderStatus).toHaveBeenCalledWith(
      expect.objectContaining({ id: order.id }),
      'CANCELLED',
      {
        rejection: { reason: 'OUT_OF_STOCK', comment: 'Нет молока', money: 'released' },
      },
    );
    expect(cards.refund).not.toHaveBeenCalled();
  });

  it('refunds a charge that was already captured', async () => {
    await build();
    const captured = {
      id: 'pay-1',
      provider: 'AGROPROMBANK_WEB',
      status: 'SUCCEEDED',
      amountCents: 3300,
      refundedCents: 0,
    };
    orders.cancelOrder.mockResolvedValue({ order: { ...cancelled, payments: [captured] }, holdReleased: false });

    const result = await service.reject('store-1', order.id, 'staff-1', { reason: 'CLOSING' });

    expect(cards.refund).toHaveBeenCalledWith(
      captured,
      3300,
      expect.objectContaining({ actorId: 'staff-1', source: 'kds' }),
    );
    expect(result.money).toBe('refunded');
  });

  it('reports the money as pending when the bank did not release the hold yet', async () => {
    await build();
    const held = {
      id: 'pay-1',
      provider: 'AGROPROMBANK',
      status: 'REQUIRES_ACTION',
      amountCents: 3300,
      refundedCents: 0,
    };
    orders.cancelOrder.mockResolvedValue({ order: { ...cancelled, payments: [held] }, holdReleased: false });

    const result = await service.reject('store-1', order.id, 'staff-1', { reason: 'TOO_BUSY' });

    expect(result.money).toBe('pending');
    expect(cards.refund).not.toHaveBeenCalled();
  });

  it('refuses an order of another store', async () => {
    await build({ ...order, storeId: 'store-2' });

    await expect(service.reject('store-1', order.id, 'staff-1', { reason: 'OTHER' })).rejects.toThrow(
      'Order not found for this store',
    );
    expect(orders.cancelOrder).not.toHaveBeenCalled();
  });
});
