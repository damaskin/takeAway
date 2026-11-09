import type { QueuePolicyService } from '../kitchen/queue-policy.service';
import type { StoreAvailabilityService } from '../kitchen/store-availability.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import { QueueRecomputeService, estimateFor } from './queue-recompute.service';

const at = (iso: string) => new Date(iso);
const ms = (iso: string) => Date.parse(iso);
const NOW = at('2026-11-09T12:00:00Z');

describe('the estimate the queue gives an order', () => {
  const promised = { pickupAt: at('2026-11-09T12:10:00Z') };

  it('is the queue’s G when it is off the promise by a minute or more', () => {
    expect(estimateFor(promised, ms('2026-11-09T12:14:30Z'), NOW)).toEqual({
      change: true,
      readyEstimateAt: at('2026-11-09T12:14:30Z'),
    });
  });

  it('is none when G keeps the promise again', () => {
    expect(estimateFor(promised, ms('2026-11-09T12:10:30Z'), NOW)).toEqual({ change: true, readyEstimateAt: null });
  });

  it('is left alone for an order past its own plan, so «Немного задерживаемся» still comes', () => {
    expect(estimateFor(promised, ms('2026-11-09T12:00:20Z'), NOW)).toEqual({ change: false });
  });
});

describe('QueueRecomputeService', () => {
  function harness(enabled = true) {
    const rows = [
      // Promised 12:10, the queue now has it at 12:16: the customer gets the new time.
      {
        id: 'late',
        userId: 'user-1',
        status: 'ACCEPTED',
        pickupAt: at('2026-11-09T12:10:00Z'),
        readyEstimateAt: null,
      },
      // Already told 12:20, still 12:20: nothing to say.
      {
        id: 'same',
        userId: 'user-2',
        status: 'PAID',
        pickupAt: at('2026-11-09T12:12:00Z'),
        readyEstimateAt: at('2026-11-09T12:20:00Z'),
      },
      // Told 12:30, now back on its promise: the estimate goes.
      {
        id: 'back',
        userId: 'user-3',
        status: 'ACCEPTED',
        pickupAt: at('2026-11-09T12:25:00Z'),
        readyEstimateAt: at('2026-11-09T12:30:00Z'),
      },
    ];
    const schedule = {
      orders: [
        { id: 'late', readyAt: ms('2026-11-09T12:16:00Z') },
        { id: 'same', readyAt: ms('2026-11-09T12:20:20Z') },
        { id: 'back', readyAt: ms('2026-11-09T12:25:00Z') },
      ],
    };
    const prisma = {
      order: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findMany: jest.fn().mockResolvedValue([{ storeId: 'store-1' }]),
      },
      store: { findUnique: jest.fn().mockResolvedValue({ status: 'OPEN', busyMeter: 0 }) },
    };
    const realtime = { emitOrderStatusChanged: jest.fn(), emitStoreLoad: jest.fn() };
    const queue = { enabled, schedule: jest.fn().mockResolvedValue({ schedule, rows }) };
    const availability = { forStore: jest.fn().mockResolvedValue({ currentEtaSeconds: 540 }) };
    const service = new QueueRecomputeService(
      prisma as unknown as PrismaService,
      realtime as unknown as RealtimeGateway,
      queue as unknown as QueuePolicyService,
      availability as unknown as StoreAvailabilityService,
    );
    return { service, prisma, realtime, queue, availability };
  }

  it("writes the moved estimates and tells each order's customer, whose apps re-read the order", async () => {
    const { service, prisma, realtime } = harness();

    expect(await service.run('store-1', NOW)).toBe(2);

    expect(prisma.order.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.order.updateMany).toHaveBeenCalledWith({
      where: { id: 'late', status: { in: ['CREATED', 'PAID', 'ACCEPTED', 'IN_PROGRESS'] } },
      data: { readyEstimateAt: at('2026-11-09T12:16:00Z') },
    });
    expect(prisma.order.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: expect.objectContaining({ id: 'back' }), data: { readyEstimateAt: null } }),
    );
    expect(realtime.emitOrderStatusChanged).toHaveBeenCalledWith(
      { orderId: 'late', status: 'ACCEPTED', etaSeconds: 960, occurredAt: NOW.toISOString() },
      'user-1',
    );
  });

  it("announces the store's «N мин» once until it changes", async () => {
    const { service, realtime, availability } = harness();
    await service.run('store-1', NOW);
    await service.run('store-1', NOW);
    expect(realtime.emitStoreLoad).toHaveBeenCalledTimes(1);
    expect(realtime.emitStoreLoad).toHaveBeenCalledWith({
      storeId: 'store-1',
      busy: false,
      busyMeter: 0,
      currentEtaSeconds: 540,
    });

    availability.forStore.mockResolvedValue({ currentEtaSeconds: 900 });
    await service.run('store-1', NOW);
    expect(realtime.emitStoreLoad).toHaveBeenCalledTimes(2);
  });

  it('passes over every store with orders in its queue once a minute', async () => {
    const { service, queue } = harness();
    await service.runActiveStores(NOW);
    expect(queue.schedule).toHaveBeenCalledWith('store-1', NOW);
  });

  it('does nothing with the flag off, and never throws', async () => {
    const off = harness(false);
    expect(await off.service.run('store-1', NOW)).toBe(0);
    off.service.touch('store-1');
    expect(off.queue.schedule).not.toHaveBeenCalled();

    const failing = harness();
    failing.queue.schedule.mockRejectedValue(new Error('connection lost'));
    await expect(failing.service.run('store-1', NOW)).resolves.toBe(0);
  });
});
