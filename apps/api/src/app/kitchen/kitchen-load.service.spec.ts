import { BadRequestException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { KitchenLoadService, SLOT_MINUTES, ceilToSlot, floorToSlot } from './kitchen-load.service';

const SLOT_MS = SLOT_MINUTES * 60 * 1000;

interface PrismaStub {
  store: { findUnique: jest.Mock };
  order: { groupBy: jest.Mock; findMany: jest.Mock; count: jest.Mock };
}

function makeService(overrides: Partial<PrismaStub> = {}): {
  service: KitchenLoadService;
  prisma: PrismaStub;
} {
  const prisma: PrismaStub = {
    store: {
      findUnique: jest.fn().mockResolvedValue({
        baseEtaSeconds: 300,
        kitchenParallelism: 2,
        slotCapacity: 4,
      }),
    },
    order: {
      groupBy: jest.fn().mockResolvedValue([]),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
    },
    ...overrides,
  };
  return { service: new KitchenLoadService(prisma as unknown as PrismaService), prisma };
}

describe('KitchenLoadService', () => {
  describe('timings', () => {
    it('separates what the customer waits from what the kitchen spends', () => {
      const { service } = makeService();

      // Three lattes at 120s each: the customer waits for one (they are made
      // alongside each other), the bar is occupied for all three.
      const { prepSeconds, workSeconds } = service.timings([{ quantity: 3, unitPrepSeconds: 120 }]);

      expect(prepSeconds).toBe(120);
      expect(workSeconds).toBe(360);
    });

    it('takes the longest item as the wait, not the sum', () => {
      const { service } = makeService();
      const { prepSeconds, workSeconds } = service.timings([
        { quantity: 1, unitPrepSeconds: 90 },
        { quantity: 2, unitPrepSeconds: 200 },
      ]);

      expect(prepSeconds).toBe(200);
      expect(workSeconds).toBe(90 + 400);
    });

    it('is zero for an empty basket', () => {
      const { service } = makeService();
      expect(service.timings([])).toEqual({ prepSeconds: 0, workSeconds: 0 });
    });
  });

  describe('queue wait', () => {
    it('divides outstanding work by how many orders run in parallel', async () => {
      const { service } = makeService();
      // 1200s of queued work over two hands = 600s of waiting.
      const waits = await service.queueWaitByStore([{ id: 'store-1', kitchenParallelism: 2 }]);
      expect(waits.get('store-1')).toBe(0);

      const busy = makeService({
        order: {
          groupBy: jest.fn().mockResolvedValue([{ storeId: 'store-1', status: 'PAID', _sum: { workSeconds: 1200 } }]),
          findMany: jest.fn(),
          count: jest.fn(),
        },
      });
      const busyWaits = await busy.service.queueWaitByStore([{ id: 'store-1', kitchenParallelism: 2 }]);
      expect(busyWaits.get('store-1')).toBe(600);
    });

    it('counts an in-progress order as half done', async () => {
      const { service } = makeService({
        order: {
          groupBy: jest.fn().mockResolvedValue([
            { storeId: 'store-1', status: 'IN_PROGRESS', _sum: { workSeconds: 400 } },
            { storeId: 'store-1', status: 'PAID', _sum: { workSeconds: 200 } },
          ]),
          findMany: jest.fn(),
          count: jest.fn(),
        },
      });

      // (400 * 0.5 + 200) / 1 = 400
      const waits = await service.queueWaitByStore([{ id: 'store-1', kitchenParallelism: 1 }]);
      expect(waits.get('store-1')).toBe(400);
    });

    it('returns zero for a store with nothing queued', async () => {
      const { service } = makeService();
      const waits = await service.queueWaitByStore([
        { id: 'quiet', kitchenParallelism: 2 },
        { id: 'also-quiet', kitchenParallelism: 3 },
      ]);
      expect([...waits.values()]).toEqual([0, 0]);
    });

    it('asks the database once for many stores', async () => {
      const { service, prisma } = makeService();
      await service.queueWaitByStore([
        { id: 'a', kitchenParallelism: 1 },
        { id: 'b', kitchenParallelism: 1 },
        { id: 'c', kitchenParallelism: 1 },
      ]);
      expect(prisma.order.groupBy).toHaveBeenCalledTimes(1);
    });

    it('does not query at all for an empty store list', async () => {
      const { service, prisma } = makeService();
      await service.queueWaitByStore([]);
      expect(prisma.order.groupBy).not.toHaveBeenCalled();
    });
  });

  describe('quote', () => {
    it('adds base overhead, queue wait and own prep', async () => {
      const { service } = makeService({
        order: {
          groupBy: jest.fn().mockResolvedValue([{ storeId: 'store-1', status: 'PAID', _sum: { workSeconds: 600 } }]),
          findMany: jest.fn(),
          count: jest.fn(),
        },
      });

      const quote = await service.quote('store-1', 150);

      expect(quote.baseEtaSeconds).toBe(300);
      expect(quote.queueWaitSeconds).toBe(300); // 600 / 2
      expect(quote.prepSeconds).toBe(150);
      expect(quote.etaSeconds).toBe(750);
    });

    it('grows the quote as the queue grows — the whole point of the model', async () => {
      const quiet = await makeService().service.quote('store-1', 120);

      const rush = await makeService({
        order: {
          groupBy: jest.fn().mockResolvedValue([{ storeId: 'store-1', status: 'PAID', _sum: { workSeconds: 2400 } }]),
          findMany: jest.fn(),
          count: jest.fn(),
        },
      }).service.quote('store-1', 120);

      expect(rush.etaSeconds).toBeGreaterThan(quiet.etaSeconds);
      expect(rush.etaSeconds - quiet.etaSeconds).toBe(1200);
    });
  });

  describe('slots', () => {
    it('marks a slot unavailable once it reaches capacity', async () => {
      const from = new Date('2026-08-22T08:00:00.000Z');
      const full = new Date('2026-08-22T08:15:00.000Z');

      const { service } = makeService({
        order: {
          groupBy: jest.fn().mockResolvedValue([]),
          // Four handovers all land in the 08:15 slot, which is capacity.
          findMany: jest.fn().mockResolvedValue(Array.from({ length: 4 }, () => ({ pickupAt: full }))),
          count: jest.fn(),
        },
      });

      const slots = await service.pickupSlots('store-1', from, 1);
      const fullSlot = slots.find((s) => s.startsAt.getTime() === full.getTime());

      expect(fullSlot?.taken).toBe(4);
      expect(fullSlot?.available).toBe(false);
      // Neighbouring slots are untouched and still bookable.
      expect(slots.filter((s) => s.available).length).toBeGreaterThan(0);
    });

    it('starts at the next whole slot, never in the past', async () => {
      const { service } = makeService();
      const from = new Date('2026-08-22T08:07:30.000Z');

      const slots = await service.pickupSlots('store-1', from, 1);

      expect(slots[0]?.startsAt.toISOString()).toBe('2026-08-22T08:15:00.000Z');
      expect(slots).toHaveLength(4); // one hour at 15-minute granularity
    });

    it('rejects an order aimed at a slot that just filled up', async () => {
      const { service } = makeService({
        order: {
          groupBy: jest.fn(),
          findMany: jest.fn(),
          count: jest.fn().mockResolvedValue(4),
        },
      });

      await expect(service.assertSlotAvailable('store-1', new Date('2026-08-22T08:15:00.000Z'))).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });

    it('lets an order through while the slot has room', async () => {
      const { service } = makeService({
        order: { groupBy: jest.fn(), findMany: jest.fn(), count: jest.fn().mockResolvedValue(3) },
      });

      await expect(service.assertSlotAvailable('store-1', new Date())).resolves.toBeUndefined();
    });

    it('counts occupancy against the containing slot, not the exact minute', async () => {
      const { service, prisma } = makeService({
        order: { groupBy: jest.fn(), findMany: jest.fn(), count: jest.fn().mockResolvedValue(0) },
      });

      await service.assertSlotAvailable('store-1', new Date('2026-08-22T08:22:41.000Z'));

      const where = prisma.order.count.mock.calls[0]?.[0]?.where;
      expect(where.pickupAt.gte.toISOString()).toBe('2026-08-22T08:15:00.000Z');
      expect(where.pickupAt.lt.toISOString()).toBe('2026-08-22T08:30:00.000Z');
    });
  });

  describe('slot boundaries', () => {
    it('floors and ceils to the 15-minute grid', () => {
      const t = new Date('2026-08-22T08:22:41.000Z');
      expect(floorToSlot(t).toISOString()).toBe('2026-08-22T08:15:00.000Z');
      expect(ceilToSlot(t).toISOString()).toBe('2026-08-22T08:30:00.000Z');
    });

    it('leaves an exact boundary alone', () => {
      const t = new Date('2026-08-22T08:30:00.000Z');
      expect(floorToSlot(t).getTime()).toBe(t.getTime());
      expect(ceilToSlot(t).getTime()).toBe(t.getTime());
      expect(ceilToSlot(t).getTime() - floorToSlot(t).getTime()).toBe(0);
      expect(SLOT_MS).toBe(900_000);
    });
  });
});
