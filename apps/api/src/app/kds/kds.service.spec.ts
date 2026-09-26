import { BadRequestException } from '@nestjs/common';
import { Test } from '@nestjs/testing';

import { NotificationsService } from '../notifications/notifications.service';
import { AgroprombankService } from '../payments/agroprombank/agroprombank.service';
import { PaymentHoldsService } from '../payments/agroprombank/payment-holds.service';
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
  let payments: { capturePreauthorizedForOrder: jest.Mock };
  let holds: { cardPaymentRequired: jest.Mock; hasCardPayment: jest.Mock };
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
    payments = { capturePreauthorizedForOrder: jest.fn().mockResolvedValue(null) };
    holds = { cardPaymentRequired: jest.fn().mockReturnValue(true), hasCardPayment: jest.fn().mockResolvedValue(true) };

    const module = await Test.createTestingModule({
      providers: [
        KdsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: RealtimeGateway,
          useValue: { emitOrderStatusChanged: jest.fn(), emitKdsOrderChanged: jest.fn() },
        },
        { provide: NotificationsService, useValue: { notifyOrderStatus: jest.fn().mockResolvedValue(undefined) } },
        { provide: AgroprombankService, useValue: payments },
        { provide: PaymentHoldsService, useValue: holds },
      ],
    }).compile();

    service = module.get(KdsService);
  });

  it('captures the hold before putting the order on the board', async () => {
    await service.accept('store-1', order.id, 'staff-1');

    expect(payments.capturePreauthorizedForOrder).toHaveBeenCalledWith(order.id);
    expect(prisma.order.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ status: 'ACCEPTED' }) }),
    );
  });

  /**
   * A declined card must not produce an accepted ticket: the kitchen would
   * start making something nobody has paid for.
   */
  it('leaves the order untouched when the bank refuses the capture', async () => {
    payments.capturePreauthorizedForOrder.mockRejectedValue(new Error('Недостаточно средств'));

    await expect(service.accept('store-1', order.id, 'staff-1')).rejects.toThrow(BadRequestException);

    expect(prisma.order.update).not.toHaveBeenCalled();
  });

  it('does not reach for the bank on an order that cannot be accepted anyway', async () => {
    prisma.order.findUnique.mockResolvedValue({ ...order, status: 'READY' });

    await expect(service.accept('store-1', order.id, 'staff-1')).rejects.toThrow(BadRequestException);

    expect(payments.capturePreauthorizedForOrder).not.toHaveBeenCalled();
  });

  /** There is no paying at the counter: no card behind the order, no ticket. */
  it('refuses an order the customer has not paid for yet', async () => {
    holds.hasCardPayment.mockResolvedValue(false);

    await expect(service.accept('store-1', order.id, 'staff-1')).rejects.toThrow(
      'The customer has not paid for this order yet',
    );

    expect(payments.capturePreauthorizedForOrder).not.toHaveBeenCalled();
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
        { provide: AgroprombankService, useValue: {} },
        { provide: PaymentHoldsService, useValue: { cardPaymentRequired: () => true } },
      ],
    }).compile();

    const rows = await module.get(KdsService).listOpen('store-1');

    expect(rows.map((r) => r.id)).toEqual(['held', 'accepted']);
  });
});
