import { BadRequestException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';

import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_BUSY_EXTRA_WAIT_SECONDS,
  DEFAULT_MAX_ASAP_WAIT_SECONDS,
  KitchenLoadService,
  SLOT_MINUTES,
  asapPlan,
  ceilToSlot,
  floorToSlot,
} from './kitchen-load.service';
import { slotFits } from './slots';

const SLOT_MS = SLOT_MINUTES * 60 * 1000;

interface StoreRow {
  status: string;
  baseEtaSeconds: number;
  kitchenParallelism: number;
  slotCapacity: number;
  timezone: string;
  workingHours: Array<{ weekday: number; opensAt: number; closesAt: number; isClosed: boolean }>;
  shifts: Array<{ extendedUntil: Date | null }>;
}

interface PrismaStub {
  store: { findUnique: jest.Mock };
  order: { groupBy: jest.Mock; findMany: jest.Mock };
}

const STORE: StoreRow = {
  status: 'OPEN',
  baseEtaSeconds: 300,
  kitchenParallelism: 2,
  slotCapacity: 4,
  timezone: 'UTC',
  // Open around the clock, so these cases isolate capacity from hours.
  workingHours: [],
  shifts: [{ extendedUntil: null }],
};

/** Open 08:00–20:00 UTC every day. */
const DAYTIME = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opensAt: 8 * 60,
  closesAt: 20 * 60,
  isClosed: false,
}));

/** Handovers already booked, as `slotLoadByStore` reads them. */
function booked(...rows: Array<[string, number]>) {
  return rows.map(([iso, workSeconds]) => ({ storeId: 'store-1', pickupAt: new Date(iso), workSeconds }));
}

function makeService(
  store: Partial<StoreRow> = {},
  orders: { queued?: unknown[]; booked?: unknown[] } = {},
  env: Record<string, string | undefined> = {},
): { service: KitchenLoadService; prisma: PrismaStub } {
  const prisma: PrismaStub = {
    store: { findUnique: jest.fn().mockResolvedValue({ ...STORE, ...store }) },
    order: {
      groupBy: jest.fn().mockResolvedValue(orders.queued ?? []),
      findMany: jest.fn().mockResolvedValue(orders.booked ?? []),
    },
  };
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  return { service: new KitchenLoadService(prisma as unknown as PrismaService, config), prisma };
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
    it('divides outstanding work by how many items run in parallel', async () => {
      const { service } = makeService();
      const waits = await service.queueWaitByStore([{ id: 'store-1', kitchenParallelism: 2, status: 'OPEN' }]);
      expect(waits.get('store-1')).toBe(0);

      // 1200s of queued work over two hands = 600s of waiting.
      const busy = makeService({}, { queued: [{ storeId: 'store-1', status: 'PAID', _sum: { workSeconds: 1200 } }] });
      const busyWaits = await busy.service.queueWaitByStore([{ id: 'store-1', kitchenParallelism: 2, status: 'OPEN' }]);
      expect(busyWaits.get('store-1')).toBe(600);
    });

    it('counts only orders due within 30 minutes, and every order being made', async () => {
      const { service, prisma } = makeService();
      const now = new Date('2026-10-14T08:00:00.000Z');
      await service.queueWaitByStore([{ id: 'store-1', kitchenParallelism: 2, status: 'OPEN' }], now);

      // A pre-order for 09:15 no longer pushes out the wait of an ASAP order placed at 08:00.
      const where = prisma.order.groupBy.mock.calls[0]?.[0]?.where;
      expect(where.OR).toEqual([
        { pickupAt: { lte: new Date('2026-10-14T08:30:00.000Z') } },
        { status: 'IN_PROGRESS' },
      ]);
    });

    it('counts an in-progress order as half done', async () => {
      const { service } = makeService(
        {},
        {
          queued: [
            { storeId: 'store-1', status: 'IN_PROGRESS', _sum: { workSeconds: 400 } },
            { storeId: 'store-1', status: 'PAID', _sum: { workSeconds: 200 } },
          ],
        },
      );

      // (400 * 0.5 + 200) / 1 = 400
      const waits = await service.queueWaitByStore([{ id: 'store-1', kitchenParallelism: 1, status: 'OPEN' }]);
      expect(waits.get('store-1')).toBe(400);
    });

    it('asks the database once for many stores, and not at all for none', async () => {
      const { service, prisma } = makeService();
      await service.queueWaitByStore([
        { id: 'a', kitchenParallelism: 1, status: 'OPEN' },
        { id: 'b', kitchenParallelism: 1, status: 'OPEN' },
      ]);
      expect(prisma.order.groupBy).toHaveBeenCalledTimes(1);
      await service.queueWaitByStore([]);
      expect(prisma.order.groupBy).toHaveBeenCalledTimes(1);
    });

    it('adds five minutes while the kitchen has pressed «Загружены», to that store only', async () => {
      const { service } = makeService(
        {},
        { queued: [{ storeId: 'busy', status: 'PAID', _sum: { workSeconds: 600 } }] },
      );

      const waits = await service.queueWaitByStore([
        { id: 'busy', kitchenParallelism: 2, status: 'OVERLOADED' },
        { id: 'calm', kitchenParallelism: 2, status: 'OPEN' },
      ]);

      expect(DEFAULT_BUSY_EXTRA_WAIT_SECONDS).toBe(300);
      expect(waits.get('busy')).toBe(300 + 300);
      expect(waits.get('calm')).toBe(0);
    });

    it('takes the busy wait from BUSY_EXTRA_WAIT_SECONDS, 0 turning it off', async () => {
      const busy = { id: 's', kitchenParallelism: 1, status: 'OVERLOADED' };
      await expect(
        makeService({}, {}, { BUSY_EXTRA_WAIT_SECONDS: '600' }).service.queueWaitSeconds(busy),
      ).resolves.toBe(600);
      await expect(makeService({}, {}, { BUSY_EXTRA_WAIT_SECONDS: '0' }).service.queueWaitSeconds(busy)).resolves.toBe(
        0,
      );
      for (const nonsense of ['', 'five', '-60', '2.5']) {
        expect(makeService({}, {}, { BUSY_EXTRA_WAIT_SECONDS: nonsense }).service.busyExtraWaitSeconds).toBe(300);
      }
    });
  });

  describe('policy from the environment', () => {
    it('defaults to a 45-minute ASAP wait, a 15-minute opening lead, alert at 3 and timeout at 8 minutes', () => {
      const { service } = makeService();
      expect(service.policy).toEqual({
        maxAsapWaitSeconds: DEFAULT_MAX_ASAP_WAIT_SECONDS,
        minScheduledLeadSeconds: 600,
        preorderHorizonSeconds: 24 * 3600,
        preorderOpeningLeadSeconds: 900,
      });
      expect(service.acceptance).toEqual({ acceptAlertSeconds: 180, acceptTimeoutSeconds: 480 });
    });

    it('reads overrides and ignores nonsense', () => {
      const { service } = makeService(
        {},
        {},
        {
          MAX_ASAP_WAIT_SECONDS: '1800',
          PREORDER_OPENING_LEAD_MINUTES: '0',
          ORDER_ACCEPT_ALERT_SECONDS: '120',
          ORDER_ACCEPT_TIMEOUT_SECONDS: 'soon',
        },
      );
      expect(service.policy.maxAsapWaitSeconds).toBe(1800);
      expect(service.policy.preorderOpeningLeadSeconds).toBe(0);
      expect(service.acceptance).toEqual({ acceptAlertSeconds: 120, acceptTimeoutSeconds: 480 });
    });

    it('never times an order out before it alerts about it', () => {
      const { service } = makeService(
        {},
        {},
        { ORDER_ACCEPT_ALERT_SECONDS: '600', ORDER_ACCEPT_TIMEOUT_SECONDS: '300' },
      );
      expect(service.acceptance).toEqual({ acceptAlertSeconds: 600, acceptTimeoutSeconds: 600 });
    });
  });

  describe('ASAP quote', () => {
    const now = new Date('2026-10-14T08:00:00.000Z');

    it('adds base overhead, queue wait and own prep', async () => {
      const { service } = makeService(
        {},
        { queued: [{ storeId: 'store-1', status: 'PAID', _sum: { workSeconds: 600 } }] },
      );

      const quote = await service.quote('store-1', 150, 150, now);

      expect(quote.baseEtaSeconds).toBe(300);
      expect(quote.queueWaitSeconds).toBe(300); // 600 / 2
      expect(quote.prepSeconds).toBe(150);
      expect(quote.etaSeconds).toBe(750);
      expect(quote.pickupAt.toISOString()).toBe('2026-10-14T08:12:30.000Z');
      expect(quote.queueFull).toBe(false);
    });

    it('quotes a busy store the busy wait on top', async () => {
      const { service } = makeService({ status: 'OVERLOADED' });
      const quote = await service.quote('store-1', 120, 120, now);
      expect(quote.queueWaitSeconds).toBe(300);
      expect(quote.etaSeconds).toBe(300 + 300 + 120);
    });

    it('spills into the next slot with room when its own slot is full by count', async () => {
      // Ready at 08:07; the 08:00 slot already holds four handovers (capacity).
      const { service } = makeService(
        {},
        {
          booked: booked(
            ['2026-10-14T08:05:00Z', 60],
            ['2026-10-14T08:06:00Z', 60],
            ['2026-10-14T08:08:00Z', 60],
            ['2026-10-14T08:10:00Z', 60],
          ),
        },
      );
      const quote = await service.quote('store-1', 120, 120, now);
      expect(quote.pickupAt.toISOString()).toBe('2026-10-14T08:15:00.000Z');
      expect(quote.etaSeconds).toBe(15 * 60);
      expect(quote.queueFull).toBe(false);
    });

    it('spills when the slot has no kitchen time left for this order', async () => {
      // Two hands = 1800 s of work per slot; 1700 s are taken in 08:00.
      const { service } = makeService({}, { booked: booked(['2026-10-14T08:10:00Z', 1700]) });
      const quote = await service.quote('store-1', 120, 240, now);
      expect(quote.pickupAt.toISOString()).toBe('2026-10-14T08:15:00.000Z');
    });

    it('reports the queue full when no slot within MAX_ASAP_WAIT_SECONDS has room — never PICKUP_SLOT_FULL', async () => {
      const everySlotFull = [];
      for (let t = now.getTime(); t < now.getTime() + 2 * 3600_000; t += SLOT_MS) {
        for (let i = 0; i < 4; i++)
          everySlotFull.push(['' + new Date(t + 60_000).toISOString(), 60] as [string, number]);
      }
      const { service } = makeService({}, { booked: booked(...everySlotFull) });
      const quote = await service.quote('store-1', 120, 120, now);
      expect(quote.queueFull).toBe(true);
      expect(quote.etaSeconds).toBe(300 + 120);
    });

    it('is the same arithmetic for the store list (no work of its own)', () => {
      const store = { id: 's', kitchenParallelism: 2, status: 'OPEN', baseEtaSeconds: 600, slotCapacity: 8 };
      const plan = asapPlan(store, 3000, undefined, 0, 0, now, { maxAsapWaitSeconds: 2700 });
      // 600 + 3000 = 60 minutes > 45: only pre-orders.
      expect(plan.queueFull).toBe(true);
      expect(asapPlan(store, 900, undefined, 0, 0, now, { maxAsapWaitSeconds: 2700 }).etaSeconds).toBe(1500);
    });
  });

  describe('pre-order slots', () => {
    it('offers 24 hours of slots, starting no sooner than 10 minutes from now', async () => {
      const { service } = makeService();
      const from = new Date('2026-10-14T08:07:30.000Z');

      const slots = await service.pickupSlots('store-1', { from });

      // 08:15 is less than ten minutes away — it used to be offered and then refused.
      expect(slots[0]?.startsAt.toISOString()).toBe('2026-10-14T08:30:00.000Z');
      expect(slots[slots.length - 1]?.startsAt.toISOString()).toBe('2026-10-15T08:00:00.000Z');
    });

    it('marks a slot unavailable once it holds slotCapacity orders', async () => {
      const full = new Date('2026-10-14T09:00:00.000Z');
      const { service } = makeService(
        {},
        { booked: booked(...Array.from({ length: 4 }, () => [full.toISOString(), 60] as [string, number])) },
      );

      const slots = await service.pickupSlots('store-1', { from: new Date('2026-10-14T08:00:00.000Z'), hours: 2 });
      const fullSlot = slots.find((s) => s.startsAt.getTime() === full.getTime());

      expect(fullSlot).toMatchObject({ taken: 4, capacity: 4, available: false });
      expect(slots.filter((s) => s.available).length).toBeGreaterThan(0);
    });

    it("marks a slot unavailable when the cart's kitchen work would not fit it", async () => {
      // 1500 s of 1800 taken at 09:00: a 240 s cart fits, a 400 s one does not.
      const { service } = makeService({}, { booked: booked(['2026-10-14T09:05:00Z', 1500]) });
      const from = new Date('2026-10-14T08:00:00.000Z');
      const at = (slots: Array<{ startsAt: Date; available: boolean }>) =>
        slots.find((s) => s.startsAt.toISOString() === '2026-10-14T09:00:00.000Z')?.available;

      expect(at(await service.pickupSlots('store-1', { from, hours: 2, workSeconds: 240 }))).toBe(true);
      expect(at(await service.pickupSlots('store-1', { from, hours: 2, workSeconds: 400 }))).toBe(false);
    });

    it('drops times outside the working hours, and the first 15 minutes after an opening nobody is there for', async () => {
      const { service } = makeService({ workingHours: DAYTIME, shifts: [] });

      // 01:00, shift closed: tomorrow-morning pre-orders start at 08:15, not at the opening.
      const slots = await service.pickupSlots('store-1', { from: new Date('2026-10-14T01:00:00.000Z') });

      expect(slots[0]?.startsAt.toISOString()).toBe('2026-10-14T08:15:00.000Z');
      expect(slots.every((s) => s.startsAt.getUTCHours() >= 8 && s.startsAt.getUTCHours() < 20)).toBe(true);
    });

    it('keeps the opening lead for a window that has not opened yet, shift open or not', async () => {
      // 20:30 with the evening shift still open: tomorrow's 08:00 opening is someone else's.
      const { service } = makeService({ workingHours: DAYTIME });
      const slots = await service.pickupSlots('store-1', { from: new Date('2026-10-14T20:30:00.000Z') });
      expect(slots[0]?.startsAt.toISOString()).toBe('2026-10-15T08:15:00.000Z');
    });
  });

  describe('booking a pre-order', () => {
    const now = new Date('2026-10-14T01:00:00.000Z');

    it('takes a slot tomorrow morning while the shift is closed', async () => {
      const { service } = makeService({ workingHours: DAYTIME, shifts: [] });
      await expect(
        service.assertScheduledSlot('store-1', new Date('2026-10-14T09:15:00.000Z'), 300, now),
      ).resolves.toBeUndefined();
    });

    it('refuses a time sooner than 10 minutes or further than 24 hours away', async () => {
      const { service } = makeService();
      const soon = service.assertScheduledSlot('store-1', new Date('2026-10-14T01:05:00.000Z'), 0, now);
      await expect(soon).rejects.toMatchObject({ response: { code: 'PICKUP_TIME_OUT_OF_RANGE', minMinutes: 10 } });
      const far = service.assertScheduledSlot('store-1', new Date('2026-10-15T01:15:00.000Z'), 0, now);
      await expect(far).rejects.toMatchObject({ response: { code: 'PICKUP_TIME_OUT_OF_RANGE', maxHours: 24 } });
    });

    it('refuses a handover outside the hours or right at an opening nobody is there for', async () => {
      const { service } = makeService({ workingHours: DAYTIME, shifts: [] });
      const night = service.assertScheduledSlot('store-1', new Date('2026-10-14T03:00:00.000Z'), 0, now);
      await expect(night).rejects.toMatchObject({ response: { code: 'STORE_CLOSED_AT_TIME' } });
      const atOpening = service.assertScheduledSlot('store-1', new Date('2026-10-14T08:00:00.000Z'), 0, now);
      await expect(atOpening).rejects.toMatchObject({ response: { code: 'STORE_CLOSED_AT_TIME' } });
    });

    it('rejects an order aimed at a slot that just filled up', async () => {
      const { service, prisma } = makeService(
        {},
        { booked: booked(...Array.from({ length: 4 }, () => ['2026-10-14T08:22:41Z', 60] as [string, number])) },
      );

      const attempt = service.assertScheduledSlot('store-1', new Date('2026-10-14T08:22:41.000Z'), 60, now);
      await expect(attempt).rejects.toBeInstanceOf(BadRequestException);
      await expect(attempt).rejects.toMatchObject({ response: { code: 'PICKUP_SLOT_FULL' } });

      // Occupancy is counted against the containing slot, not the exact minute.
      const where = prisma.order.findMany.mock.calls[0]?.[0]?.where;
      expect(where.pickupAt.gte.toISOString()).toBe('2026-10-14T08:15:00.000Z');
      expect(where.pickupAt.lt.toISOString()).toBe('2026-10-14T08:30:00.000Z');
    });
  });

  describe('slot arithmetic', () => {
    const store = { slotCapacity: 4, kitchenParallelism: 2 };

    it('is full by count or by kitchen work', () => {
      expect(slotFits(undefined, store, 300)).toBe(true);
      expect(slotFits({ count: 4, workSeconds: 0 }, store, 0)).toBe(false);
      expect(slotFits({ count: 1, workSeconds: 1700 }, store, 100)).toBe(true);
      expect(slotFits({ count: 1, workSeconds: 1700 }, store, 101)).toBe(false);
    });

    it('lets an order bigger than a whole slot into an empty one', () => {
      expect(slotFits({ count: 0, workSeconds: 0 }, store, 5000)).toBe(true);
    });

    it('floors and ceils to the 15-minute grid', () => {
      const t = new Date('2026-08-22T08:22:41.000Z');
      expect(floorToSlot(t).toISOString()).toBe('2026-08-22T08:15:00.000Z');
      expect(ceilToSlot(t).toISOString()).toBe('2026-08-22T08:30:00.000Z');
      const edge = new Date('2026-08-22T08:30:00.000Z');
      expect(floorToSlot(edge).getTime()).toBe(edge.getTime());
      expect(ceilToSlot(edge).getTime()).toBe(edge.getTime());
      expect(SLOT_MS).toBe(900_000);
    });
  });
});
