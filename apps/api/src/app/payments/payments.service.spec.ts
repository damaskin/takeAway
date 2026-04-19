import { Test } from '@nestjs/testing';

import { NotificationsService } from '../notifications/notifications.service';
import { OrdersService } from '../orders/orders.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { PaymentsService } from './payments.service';
import { STRIPE_CLIENT, StripeConfig } from './stripe.config';

/**
 * Integration-ish test: we stub Stripe + Prisma + realtime so we can exercise
 * handleWebhook() deterministically and make sure a payment_intent.succeeded
 * event:
 *   - flips the order status to PAID,
 *   - marks the Payment row SUCCEEDED,
 *   - broadcasts on the user/order/kds channels,
 *   - calls OrdersService.creditLoyaltyForPayment.
 */
describe('PaymentsService.handleWebhook', () => {
  let service: PaymentsService;
  let prisma: jest.Mocked<Partial<PrismaService>>;
  let realtime: jest.Mocked<Partial<RealtimeGateway>>;
  let orders: jest.Mocked<Partial<OrdersService>>;
  let stripe: {
    webhooks: { constructEvent: jest.Mock };
    paymentIntents: { create: jest.Mock; retrieve: jest.Mock };
  };

  const baseOrder = {
    id: 'order-1',
    userId: 'user-1',
    storeId: 'store-1',
    status: 'CREATED',
    subtotalCents: 500,
    totalCents: 500,
  };

  beforeEach(async () => {
    prisma = {
      order: {
        findUnique: jest.fn(({ where }) => {
          if (where.id === baseOrder.id) return Promise.resolve(baseOrder);
          return Promise.resolve(null);
        }),
        update: jest.fn().mockResolvedValue({ ...baseOrder, status: 'PAID' }),
      } as unknown as PrismaService['order'],
      payment: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      } as unknown as PrismaService['payment'],
      store: {
        findUnique: jest.fn().mockResolvedValue({ currentEtaSeconds: 300 }),
      } as unknown as PrismaService['store'],
      $transaction: jest.fn((ops: unknown[]) => {
        // Our service uses $transaction([prisma.payment.updateMany, prisma.order.update])
        // — the test just resolves those mocks in order so the final value
        // matches what the service expects (second promise is the updated order).
        return Promise.all(ops as Promise<unknown>[]);
      }),
    } as unknown as jest.Mocked<Partial<PrismaService>>;

    realtime = {
      emitOrderStatusChanged: jest.fn(),
      emitKdsOrderChanged: jest.fn(),
    };

    orders = {
      creditLoyaltyForPayment: jest.fn().mockResolvedValue(undefined),
    };

    // Add items to the mocked findUnique for the KDS payload enrichment step.
    (prisma.order as unknown as { findUnique: jest.Mock }).findUnique = jest.fn(async ({ where }) => {
      if (where.id === baseOrder.id) {
        return {
          ...baseOrder,
          // Shape used inside onPaymentSucceeded after the tx call
          orderCode: '4242',
          pickupMode: 'ASAP',
          pickupAt: new Date(),
          createdAt: new Date(),
          customerName: 'Raynor',
          notes: null,
          items: [{ productSnapshot: { name: 'Caramel latte' }, quantity: 1 }],
        };
      }
      return null;
    });

    stripe = {
      webhooks: {
        constructEvent: jest.fn(() => ({
          type: 'payment_intent.succeeded',
          data: {
            object: {
              id: 'pi_test_123',
              status: 'succeeded',
              amount: 500,
              metadata: { orderId: baseOrder.id, userId: baseOrder.userId },
            },
          },
        })),
      },
      paymentIntents: { create: jest.fn(), retrieve: jest.fn() },
    };

    const module = await Test.createTestingModule({
      providers: [
        PaymentsService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: StripeConfig,
          useValue: { webhookSecret: 'whsec_test' } as Partial<StripeConfig>,
        },
        { provide: RealtimeGateway, useValue: realtime },
        { provide: OrdersService, useValue: orders },
        {
          provide: NotificationsService,
          useValue: {
            notifyOrderStatus: jest.fn().mockResolvedValue(undefined),
            notifyBrandStaffNewOrder: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: STRIPE_CLIENT, useValue: stripe },
      ],
    }).compile();

    service = module.get(PaymentsService);
  });

  it('flips the order to PAID, emits on all channels, and credits loyalty', async () => {
    await service.handleWebhook(Buffer.from('{}'), 'sig-1');

    expect(stripe.webhooks.constructEvent).toHaveBeenCalledWith(expect.any(Buffer), 'sig-1', 'whsec_test');
    expect((prisma.payment as unknown as { updateMany: jest.Mock }).updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { providerRef: 'pi_test_123' },
        data: expect.objectContaining({ status: 'SUCCEEDED' }),
      }),
    );
    expect((prisma.order as unknown as { update: jest.Mock }).update).toHaveBeenCalled();
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      expect.objectContaining({ orderId: baseOrder.id, status: 'PAID' }),
      baseOrder.userId,
    );
    expect(realtime.emitKdsOrderChanged).toHaveBeenCalledWith(
      expect.objectContaining({ kind: 'created', orderId: baseOrder.id, storeId: baseOrder.storeId }),
    );
    expect(orders.creditLoyaltyForPayment).toHaveBeenCalledWith(baseOrder.id);
  });

  it('swallows loyalty-credit errors so a ledger failure does not break the webhook', async () => {
    (orders.creditLoyaltyForPayment as jest.Mock).mockRejectedValueOnce(new Error('ledger down'));
    await expect(service.handleWebhook(Buffer.from('{}'), 'sig-2')).resolves.toBeUndefined();
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalled();
  });
});
