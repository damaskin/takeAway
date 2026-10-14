import { type OrderStatus, Prisma } from '@prisma/client';

import type { KitchenLoadService } from '../kitchen/kitchen-load.service';
import { hoursAround, type WorkingHour } from '../kitchen/opening-hours';
import type { StoreAvailabilityService, StoreAvailabilityView } from '../kitchen/store-availability.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import type { StoreAvailabilityNotifier } from '../realtime/store-availability.notifier';
import { customerArrival } from './kds-row';
import {
  StoreShiftService,
  autoCloseDue,
  extensionTarget,
  keepsShiftOpen,
  summarizeForClose,
} from './store-shift.service';

/** 09:00–21:00 every day, UTC. */
const HOURS: WorkingHour[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opensAt: 9 * 60,
  closesAt: 21 * 60,
  isClosed: false,
}));

const at = (iso: string) => new Date(iso);

const VIEW: StoreAvailabilityView = {
  acceptingOrders: true,
  openNow: true,
  asapBlockedReason: null,
  opensAt: null,
  closesAt: at('2026-10-14T21:00:00Z'),
  withinHours: true,
  extendedUntil: null,
  currentEtaSeconds: 600,
};

interface OrderRow {
  status: OrderStatus;
  pickupAt: Date;
  kitchenVisibleAt: Date | null;
  payments: Array<{ id: string }>;
}

function harness(
  opts: {
    openShift?: { id: string; openedAt?: Date; extendedUntil?: Date | null } | null;
    status?: 'OPEN' | 'OVERLOADED' | 'CLOSED';
    orders?: OrderRow[];
    hours?: WorkingHour[];
  } = {},
) {
  let status: string = opts.status ?? 'OPEN';
  const openShift = opts.openShift ?? null;
  const shiftRow = openShift && {
    id: openShift.id,
    openedAt: openShift.openedAt ?? at('2026-10-14T08:50:00Z'),
    extendedUntil: openShift.extendedUntil ?? null,
  };
  const prisma = {
    store: {
      findUnique: jest.fn(async () => ({
        id: 'store-1',
        status,
        busyMeter: 0,
        baseEtaSeconds: 600,
        kitchenParallelism: 2,
        timezone: 'UTC',
        workingHours: opts.hours ?? HOURS,
        shifts: shiftRow ? [shiftRow] : [],
      })),
      updateMany: jest.fn(async ({ where, data }: { where: { status: string }; data: { status: string } }) => {
        if (where.status !== status) return { count: 0 };
        status = data.status;
        return { count: 1 };
      }),
    },
    storeShift: {
      findFirst: jest.fn(async ({ where }: { where: { closedAt?: null } }) => {
        if ('closedAt' in where) return openShift;
        return openShift
          ? {
              id: openShift.id,
              storeId: 'store-1',
              openedAt: at('2026-09-26T07:00:00Z'),
              closedAt: null,
              closedAutomatically: false,
              openedBy: { name: 'Анна', email: null },
              closedBy: null,
            }
          : null;
      }),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    order: { findMany: jest.fn().mockResolvedValue(opts.orders ?? []) },
  };
  const realtime = { emitKdsShiftChanged: jest.fn(), emitStoreLoad: jest.fn() };
  const availability = { announce: jest.fn().mockResolvedValue(undefined) };
  const kitchen = { queueWaitSeconds: jest.fn().mockResolvedValue(240) };
  const rules = { forStore: jest.fn().mockResolvedValue({ ...VIEW, brandId: 'brand-1', status: 'OPEN' }) };
  const service = new StoreShiftService(
    prisma as unknown as PrismaService,
    realtime as unknown as RealtimeGateway,
    availability as unknown as StoreAvailabilityNotifier,
    kitchen as unknown as KitchenLoadService,
    rules as unknown as StoreAvailabilityService,
  );
  return { service, prisma, realtime, availability, kitchen, rules, status: () => status };
}

const order = (status: OrderStatus, pickupIso: string, visible = true): OrderRow => ({
  status,
  pickupAt: at(pickupIso),
  kitchenVisibleAt: visible ? at('2026-10-14T07:00:00Z') : null,
  payments: [],
});

describe('StoreShiftService', () => {
  it('reports a store that never had a shift as closed, with what the hours mean for ASAP orders', async () => {
    const { service, rules } = harness();
    rules.forStore.mockResolvedValue({
      ...VIEW,
      openNow: false,
      asapBlockedReason: 'SHIFT_CLOSED',
      brandId: 'brand-1',
      status: 'OPEN',
    });
    await expect(service.current('store-1')).resolves.toEqual({
      storeId: 'store-1',
      open: false,
      openedAt: null,
      openedByName: null,
      closedAt: null,
      closedByName: null,
      busy: false,
      extendedUntil: null,
      closesAt: '2026-10-14T21:00:00.000Z',
      opensAt: null,
      asapOpen: false,
      asapBlockedReason: 'SHIFT_CLOSED',
      closedAutomatically: false,
    });
  });

  it('opens a shift once and tells every kitchen screen of the store', async () => {
    const { service, prisma, realtime } = harness();
    await service.open('store-1', 'staff-1');
    expect(prisma.storeShift.create).toHaveBeenCalledWith({ data: { storeId: 'store-1', openedById: 'staff-1' } });
    expect(realtime.emitKdsShiftChanged).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store-1' }));
  });

  it('does not open a second shift when one is already open', async () => {
    const { service, prisma } = harness({ openShift: { id: 'shift-1' } });
    const shift = await service.open('store-1', 'staff-2');
    expect(prisma.storeShift.create).not.toHaveBeenCalled();
    expect(shift.open).toBe(true);
    expect(shift.openedByName).toBe('Анна');
  });

  it('treats losing the race to another tablet as success', async () => {
    const { service, prisma } = harness();
    prisma.storeShift.create.mockRejectedValue(
      new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
    );
    await expect(service.open('store-1', 'staff-1')).resolves.toMatchObject({ storeId: 'store-1' });
  });

  it('closes whatever shift is open and records who closed it', async () => {
    const { service, prisma } = harness({ openShift: { id: 'shift-1' } });
    await service.close('store-1', 'staff-1');
    expect(prisma.storeShift.updateMany).toHaveBeenCalledWith({
      where: { storeId: 'store-1', closedAt: null },
      data: { closedAt: expect.any(Date), closedById: 'staff-1' },
    });
  });

  describe('"Finish work" with orders on the board', () => {
    const now = at('2026-10-14T20:50:00Z');

    it('is refused with SHIFT_HAS_UNACCEPTED_ORDERS while orders due soon wait for «Принять»', async () => {
      const { service, prisma } = harness({
        openShift: { id: 'shift-1' },
        orders: [order('CREATED', '2026-10-14T21:05:00Z'), order('PAID', '2026-10-14T21:10:00Z')],
      });
      await expect(service.close('store-1', 'staff-1', now)).rejects.toMatchObject({
        status: 409,
        response: { code: 'SHIFT_HAS_UNACCEPTED_ORDERS', count: 2 },
      });
      expect(prisma.storeShift.updateMany).not.toHaveBeenCalled();
    });

    it('closes with orders being made, ready, or pre-ordered for tomorrow', async () => {
      const { service, prisma } = harness({
        openShift: { id: 'shift-1' },
        orders: [
          order('IN_PROGRESS', '2026-10-14T20:55:00Z'),
          order('READY', '2026-10-14T20:40:00Z'),
          order('CREATED', '2026-10-15T09:15:00Z'),
          // Not paid yet: not the kitchen's business.
          order('CREATED', '2026-10-14T21:00:00Z', false),
        ],
      });
      await service.close('store-1', 'staff-1', now);
      expect(prisma.storeShift.updateMany).toHaveBeenCalled();
    });

    it('sorts the open orders the way the close dialog shows them', () => {
      expect(
        summarizeForClose(
          [
            order('CREATED', '2026-10-14T21:05:00Z'),
            order('ACCEPTED', '2026-10-14T21:00:00Z'),
            order('ACCEPTED', '2026-10-15T09:15:00Z'),
            order('IN_PROGRESS', '2026-10-14T23:00:00Z'),
            order('READY', '2026-10-14T20:30:00Z'),
            order('PAID', '2026-10-15T08:30:00Z'),
            order('CREATED', '2026-10-14T21:00:00Z', false),
          ],
          now,
        ),
      ).toEqual({ awaitingAcceptance: 1, inProgress: 2, ready: 1, later: 2 });
    });
  });

  it.each(['open', 'close'] as const)(
    'announces to every client whether the store takes orders after %s',
    async (action) => {
      const { service, availability } = harness({ openShift: action === 'close' ? { id: 'shift-1' } : null });
      await service[action]('store-1', 'staff-1');
      expect(availability.announce).toHaveBeenCalledWith('store-1');
    },
  );

  it('answers 404 for a store that does not exist', async () => {
    const { service, prisma } = harness();
    prisma.store.findUnique.mockResolvedValue(null as never);
    await expect(service.open('nope', 'staff-1')).rejects.toMatchObject({ status: 404 });
  });

  describe('«Продлить»', () => {
    it('extends past the closing time and tells the kitchens and the storefronts', async () => {
      const { service, prisma, realtime, availability } = harness({ openShift: { id: 'shift-1' } });
      await service.extend('store-1', 30, at('2026-10-14T20:50:00Z'));
      expect(prisma.storeShift.updateMany).toHaveBeenCalledWith({
        where: { id: 'shift-1', closedAt: null },
        data: { extendedUntil: at('2026-10-14T21:30:00Z') },
      });
      expect(realtime.emitKdsShiftChanged).toHaveBeenCalled();
      expect(availability.announce).toHaveBeenCalledWith('store-1');
    });

    it('needs an open shift', async () => {
      const { service } = harness();
      await expect(service.extend('store-1', 30, at('2026-10-14T20:50:00Z'))).rejects.toMatchObject({
        status: 409,
        response: { code: 'SHIFT_NOT_OPEN' },
      });
    });

    it('is not needed for a store open around the clock', async () => {
      const { service } = harness({ openShift: { id: 'shift-1' }, hours: [] });
      await expect(service.extend('store-1', 60, at('2026-10-14T20:50:00Z'))).rejects.toMatchObject({
        response: { code: 'SHIFT_EXTENSION_NOT_NEEDED' },
      });
    });

    describe('where an extension ends', () => {
      const hours = (iso: string) => hoursAround(HOURS, 'UTC', at(iso));
      const shift = (extendedUntil: string | null, openedAt = '2026-10-14T08:50:00Z') => ({
        openedAt: at(openedAt),
        extendedUntil: extendedUntil ? at(extendedUntil) : null,
      });

      it('runs from the closing time, the current extension or now, whichever is latest', () => {
        expect(extensionTarget(hours('2026-10-14T20:50:00Z'), shift(null), 30, at('2026-10-14T20:50:00Z'))).toEqual(
          at('2026-10-14T21:30:00Z'),
        );
        expect(
          extensionTarget(hours('2026-10-14T21:20:00Z'), shift('2026-10-14T21:30:00Z'), 60, at('2026-10-14T21:20:00Z')),
        ).toEqual(at('2026-10-14T22:30:00Z'));
        // After hours with the extension already over: from now.
        expect(extensionTarget(hours('2026-10-14T21:40:00Z'), shift(null), 30, at('2026-10-14T21:40:00Z'))).toEqual(
          at('2026-10-14T22:10:00Z'),
        );
      });

      it('stops four hours past the closing', () => {
        const now = at('2026-10-15T00:40:00Z');
        expect(extensionTarget(hours('2026-10-15T00:40:00Z'), shift('2026-10-15T00:50:00Z'), 60, now)).toEqual(
          at('2026-10-15T01:00:00Z'),
        );
        expect(extensionTarget(hours('2026-10-15T00:40:00Z'), shift('2026-10-15T01:00:00Z'), 30, now)).toBe('LIMIT');
      });

      it('lets a shift opened early take ASAP orders before the opening', () => {
        const now = at('2026-10-14T08:30:00Z');
        expect(extensionTarget(hours('2026-10-14T08:30:00Z'), shift(null, '2026-10-14T08:20:00Z'), 30, now)).toEqual(
          at('2026-10-14T09:00:00Z'),
        );
      });
    });
  });

  describe('closing by the schedule', () => {
    const grace = 10 * 60;
    const hours = (iso: string) => hoursAround(HOURS, 'UTC', at(iso));
    const openedInTheMorning = { openedAt: at('2026-10-14T08:50:00Z'), extendedUntil: null };

    it('waits for the grace after the closing time, then closes', () => {
      expect(autoCloseDue(hours('2026-10-14T20:59:00Z'), openedInTheMorning, grace, at('2026-10-14T20:59:00Z'))).toBe(
        false,
      );
      expect(autoCloseDue(hours('2026-10-14T21:05:00Z'), openedInTheMorning, grace, at('2026-10-14T21:05:00Z'))).toBe(
        false,
      );
      expect(autoCloseDue(hours('2026-10-14T21:10:00Z'), openedInTheMorning, grace, at('2026-10-14T21:10:00Z'))).toBe(
        true,
      );
    });

    it('leaves a shift with a running extension alone, and counts the grace from its end', () => {
      const extended = { ...openedInTheMorning, extendedUntil: at('2026-10-14T21:30:00Z') };
      expect(autoCloseDue(hours('2026-10-14T21:20:00Z'), extended, grace, at('2026-10-14T21:20:00Z'))).toBe(false);
      expect(autoCloseDue(hours('2026-10-14T21:35:00Z'), extended, grace, at('2026-10-14T21:35:00Z'))).toBe(false);
      expect(autoCloseDue(hours('2026-10-14T21:40:00Z'), extended, grace, at('2026-10-14T21:40:00Z'))).toBe(true);
    });

    it('does not close a shift opened early for the morning, nor one for a store open around the clock', () => {
      const early = { openedAt: at('2026-10-14T08:10:00Z'), extendedUntil: null };
      expect(autoCloseDue(hours('2026-10-14T08:30:00Z'), early, grace, at('2026-10-14T08:30:00Z'))).toBe(false);
      const allDay = hoursAround([], 'UTC', at('2026-10-14T03:00:00Z'));
      expect(autoCloseDue(allDay, early, grace, at('2026-10-14T03:00:00Z'))).toBe(false);
    });

    it('keeps the shift open while an order due soon is waiting or being made — ready ones do not count', () => {
      const now = at('2026-10-14T21:10:00Z');
      expect(keepsShiftOpen([order('READY', '2026-10-14T20:55:00Z')], now)).toBe(false);
      expect(keepsShiftOpen([order('ACCEPTED', '2026-10-14T21:20:00Z')], now)).toBe(true);
      expect(keepsShiftOpen([order('IN_PROGRESS', '2026-10-15T09:00:00Z')], now)).toBe(true);
      expect(keepsShiftOpen([order('CREATED', '2026-10-15T09:15:00Z')], now)).toBe(false);
    });

    it('closes with no person, marked as closed by the schedule, and clears «Загружены»', async () => {
      const { service, prisma, status, availability } = harness({ openShift: { id: 'shift-1' }, status: 'OVERLOADED' });
      await expect(service.closeBySchedule('store-1', grace, at('2026-10-14T21:15:00Z'))).resolves.toBe(true);
      expect(prisma.storeShift.updateMany).toHaveBeenCalledWith({
        where: { id: 'shift-1', closedAt: null },
        data: { closedAt: at('2026-10-14T21:15:00Z'), closedById: null, closedAutomatically: true },
      });
      expect(status()).toBe('OPEN');
      expect(availability.announce).toHaveBeenCalledWith('store-1');
    });

    it('does not close while an order is still being made', async () => {
      const { service, prisma } = harness({
        openShift: { id: 'shift-1' },
        orders: [order('IN_PROGRESS', '2026-10-14T21:05:00Z')],
      });
      await expect(service.closeBySchedule('store-1', grace, at('2026-10-14T21:15:00Z'))).resolves.toBe(false);
      expect(prisma.storeShift.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('«Загружены»', () => {
    it('marks the store OVERLOADED and tells the kitchens, the storefronts and the load channel', async () => {
      const { service, realtime, availability, kitchen, status } = harness({ openShift: { id: 'shift-1' } });
      const shift = await service.setBusy('store-1', true);

      expect(status()).toBe('OVERLOADED');
      expect(shift.busy).toBe(true);
      expect(realtime.emitKdsShiftChanged).toHaveBeenCalledWith({
        storeId: 'store-1',
        shift: expect.objectContaining({ busy: true, open: true }),
      });
      expect(availability.announce).toHaveBeenCalledWith('store-1');
      // Full meter, and the ETA is still the real queue: base 600 + 240
      // waiting, the busy wait included.
      expect(kitchen.queueWaitSeconds).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'store-1', kitchenParallelism: 2, status: 'OVERLOADED' }),
      );
      expect(realtime.emitStoreLoad).toHaveBeenCalledWith({
        storeId: 'store-1',
        busy: true,
        busyMeter: 100,
        currentEtaSeconds: 840,
      });
    });

    it('switches back to OPEN, and does nothing the second time', async () => {
      const { service, prisma, status } = harness({ openShift: { id: 'shift-1' }, status: 'OVERLOADED' });
      await expect(service.setBusy('store-1', false)).resolves.toMatchObject({ busy: false });
      expect(status()).toBe('OPEN');
      prisma.store.updateMany.mockClear();
      await service.setBusy('store-1', false);
      expect(prisma.store.updateMany).not.toHaveBeenCalled();
    });

    it('refuses a store that is switched off with STORE_SWITCHED_OFF and leaves it off', async () => {
      const { service, status } = harness({ status: 'CLOSED' });
      await expect(service.setBusy('store-1', true)).rejects.toMatchObject({
        status: 409,
        response: { code: 'STORE_SWITCHED_OFF' },
      });
      expect(status()).toBe('CLOSED');
    });

    it('is cleared when the shift ends, so tomorrow does not open busy', async () => {
      const { service, status, realtime } = harness({ openShift: { id: 'shift-1' }, status: 'OVERLOADED' });
      await service.close('store-1', 'staff-1');
      expect(status()).toBe('OPEN');
      expect(realtime.emitStoreLoad).toHaveBeenCalledWith(expect.objectContaining({ busy: false, busyMeter: 0 }));
    });
  });
});

describe('customerArrival', () => {
  it('is empty until the customer sends anything', () => {
    expect(customerArrival([])).toEqual({ customerArrival: null, customerArrivedAt: null });
  });

  it('shows the customer as here once they tapped "I\'m here", even after a nearby ping', () => {
    expect(
      customerArrival([
        { type: 'CUSTOMER_NEARBY', createdAt: at('2026-09-26T08:00:00Z') },
        { type: 'CUSTOMER_HERE', createdAt: at('2026-09-26T08:03:00Z') },
      ]),
    ).toEqual({ customerArrival: 'HERE', customerArrivedAt: '2026-09-26T08:03:00.000Z' });
  });

  it('shows the customer as nearby before they arrive', () => {
    expect(customerArrival([{ type: 'CUSTOMER_NEARBY', createdAt: at('2026-09-26T08:00:00Z') }])).toEqual({
      customerArrival: 'NEARBY',
      customerArrivedAt: '2026-09-26T08:00:00.000Z',
    });
  });
});
