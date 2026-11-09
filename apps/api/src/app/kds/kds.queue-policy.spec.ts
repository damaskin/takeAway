import type { QueuePolicyService } from '../kitchen/queue-policy.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { OrdersService } from '../orders/orders.service';
import type { QueueRecomputeService } from '../orders/queue-recompute.service';
import type { PaymentHoldsService } from '../payments/agroprombank/payment-holds.service';
import type { CardPaymentsService } from '../payments/card-payments.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import { KdsService } from './kds.service';

const at = (iso: string) => new Date(iso);

/** A paid order for now, promised at 12:10, that the kitchen accepts late. */
const ORDER = {
  id: 'order-1',
  storeId: 'store-1',
  userId: 'user-1',
  orderCode: '4242',
  status: 'PAID' as const,
  fulfillmentType: 'PICKUP' as const,
  pickupMode: 'ASAP' as const,
  pickupAt: at('2026-11-09T12:10:00Z'),
  createdAt: at('2026-11-09T12:00:00Z'),
  customerName: null,
  notes: null,
  prepSeconds: 300,
  workSeconds: 300,
  kitchenVisibleAt: at('2026-11-09T12:00:00Z'),
  readyEstimateAt: null as Date | null,
  items: [],
  events: [],
  payments: [],
  store: { kitchenParallelism: 1, baseEtaSeconds: 300, timezone: 'UTC' },
};

function harness() {
  const prisma = {
    order: {
      findUnique: jest.fn().mockResolvedValue(ORDER),
      update: jest.fn().mockResolvedValue({ ...ORDER, status: 'ACCEPTED' }),
      findMany: jest.fn().mockResolvedValue([ORDER]),
    },
  };
  const realtime = { emitOrderStatusChanged: jest.fn(), emitKdsOrderChanged: jest.fn() };
  const notifications = { notifyOrderStatus: jest.fn().mockResolvedValue(undefined) };
  const holds = {
    cardPaymentRequired: jest.fn().mockReturnValue(false),
    hasCardPayment: jest.fn(),
    findHold: jest.fn().mockResolvedValue(null),
  };
  const cards = { captureHoldForOrder: jest.fn().mockResolvedValue(null) };
  const queue = {
    enabled: true,
    plans: jest
      .fn()
      .mockResolvedValue(
        new Map([
          ['order-1', { startAt: Date.parse('2026-11-09T12:05:00Z'), readyAt: Date.parse('2026-11-09T12:16:00Z') }],
        ]),
      ),
  };
  const recompute = {
    run: jest.fn(async () => {
      // The recompute wrote the queue's G as the estimate.
      prisma.order.findUnique.mockResolvedValue({
        ...ORDER,
        status: 'ACCEPTED',
        readyEstimateAt: at('2026-11-09T12:16:00Z'),
      });
      return 1;
    }),
  };
  const service = new KdsService(
    prisma as unknown as PrismaService,
    realtime as unknown as RealtimeGateway,
    notifications as unknown as NotificationsService,
    cards as unknown as CardPaymentsService,
    holds as unknown as PaymentHoldsService,
    {} as OrdersService,
    queue as unknown as QueuePolicyService,
    recompute as unknown as QueueRecomputeService,
  );
  return { service, prisma, realtime, notifications, queue, recompute };
}

describe('KdsService under the queue policy', () => {
  it("shows each ticket's start and ready time from the queue («начать в 12:05», «готов к 12:16»)", async () => {
    const { service, queue } = harness();

    const [row] = await service.listOpen('store-1');

    expect(queue.plans).toHaveBeenCalledWith(['store-1']);
    expect(row).toMatchObject({ startBy: '2026-11-09T12:05:00.000Z', plannedReadyAt: '2026-11-09T12:16:00.000Z' });
  });

  it("takes the new estimate from the queue's recompute, not from the order's own cooking", async () => {
    const { service, prisma, recompute, notifications } = harness();

    const result = await service.accept('store-1', 'order-1', 'staff-1');

    const data = prisma.order.update.mock.calls[0]?.[0]?.data as Record<string, unknown>;
    expect(data).not.toHaveProperty('readyEstimateAt');
    expect(recompute.run).toHaveBeenCalledWith('store-1');
    expect(result.readyEstimateAt).toBe('2026-11-09T12:16:00.000Z');
    // «Заведение уже готовит ваш заказ — будет готов примерно к 12:16»
    expect(notifications.notifyOrderStatus).toHaveBeenCalledWith(expect.anything(), 'ACCEPTED', {
      readyEstimate: '12:16',
    });
  });

  it('sends the refreshed ticket with its queue times to the board', async () => {
    const { service, realtime } = harness();

    await service.accept('store-1', 'order-1', 'staff-1');

    expect(realtime.emitKdsOrderChanged).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'updated',
        order: expect.objectContaining({ plannedReadyAt: '2026-11-09T12:16:00.000Z' }),
      }),
    );
  });
});
