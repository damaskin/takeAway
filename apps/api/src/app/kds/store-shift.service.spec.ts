import { Prisma } from '@prisma/client';

import { hoursAround, type WorkingHour } from '../kitchen/opening-hours';
import type { StoreAvailabilityService, StoreAvailabilityView } from '../kitchen/store-availability.service';
import type { NotificationsService } from '../notifications/notifications.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import type { StoreAvailabilityNotifier } from '../realtime/store-availability.notifier';
import { customerArrival } from './kds-row';
import { StoreShiftService, autoCloseDue, extensionRefusal, extensionTarget, pauseEnd } from './store-shift.service';

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
  pausedUntil: null,
  pauseReason: null,
  currentEtaSeconds: 780,
};

interface PauseRow {
  pausedUntil: Date | null;
  pauseReason: 'EQUIPMENT' | 'NO_INGREDIENTS' | 'NO_STAFF' | 'OTHER' | null;
  pauseComment: string | null;
  pausedById: string | null;
}

function harness(
  opts: {
    openShift?: { id: string; openedAt?: Date; extendedUntil?: Date | null } | null;
    status?: 'OPEN' | 'OVERLOADED' | 'CLOSED';
    hours?: WorkingHour[];
    pause?: Partial<PauseRow>;
  } = {},
) {
  let status: string = opts.status ?? 'OPEN';
  let pause: PauseRow = { pausedUntil: null, pauseReason: null, pauseComment: null, pausedById: null, ...opts.pause };
  const openShift = opts.openShift ?? null;
  const shiftRow = openShift && {
    id: openShift.id,
    openedAt: openShift.openedAt ?? at('2026-10-14T09:00:00Z'),
    extendedUntil: openShift.extendedUntil ?? null,
  };
  const prisma = {
    store: {
      findUnique: jest.fn(async () => ({
        id: 'store-1',
        name: 'Центр',
        status,
        busyMeter: 0,
        baseEtaSeconds: 600,
        timezone: 'UTC',
        ...pause,
        workingHours: opts.hours ?? HOURS,
        shifts: shiftRow ? [shiftRow] : [],
      })),
      update: jest.fn(async ({ data }: { data: Partial<PauseRow> }) => {
        pause = { ...pause, ...data };
        return {};
      }),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { status?: string; pausedUntil?: { not: null; lte?: Date } };
          data: Partial<PauseRow> & { status?: string };
        }) => {
          if (where.pausedUntil) {
            const due = where.pausedUntil.lte;
            if (!pause.pausedUntil || (due && pause.pausedUntil > due)) return { count: 0 };
            pause = { ...pause, ...data };
            return { count: 1 };
          }
          if (where.status !== status) return { count: 0 };
          status = data.status ?? status;
          return { count: 1 };
        },
      ),
    },
    storeShift: {
      findFirst: jest.fn(async () =>
        openShift
          ? {
              id: openShift.id,
              storeId: 'store-1',
              openedAt: at('2026-10-14T09:00:00Z'),
              closedAt: null,
              closedAutomatically: false,
              openedAutomatically: true,
              openedBy: null,
              closedBy: null,
            }
          : null,
      ),
      create: jest.fn().mockResolvedValue({}),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    user: { findUnique: jest.fn().mockResolvedValue({ name: 'Анна', email: null, login: null }) },
    order: { findMany: jest.fn().mockResolvedValue([]) },
  };
  const realtime = { emitKdsShiftChanged: jest.fn(), emitStoreLoad: jest.fn() };
  const availability = { announce: jest.fn().mockResolvedValue(undefined) };
  const rules = { forStore: jest.fn().mockResolvedValue({ ...VIEW, brandId: 'brand-1', status: 'OPEN' }) };
  const notifications = { notifyStoreTeam: jest.fn().mockResolvedValue(1) };
  const service = new StoreShiftService(
    prisma as unknown as PrismaService,
    realtime as unknown as RealtimeGateway,
    availability as unknown as StoreAvailabilityNotifier,
    rules as unknown as StoreAvailabilityService,
    notifications as unknown as NotificationsService,
  );
  return {
    service,
    prisma,
    realtime,
    availability,
    rules,
    notifications,
    status: () => status,
    pause: () => pause,
  };
}

describe('StoreShiftService', () => {
  it('reports a store with no shift yet, with what the hours mean for ASAP orders', async () => {
    const { service, rules } = harness();
    rules.forStore.mockResolvedValue({
      ...VIEW,
      openNow: false,
      asapBlockedReason: 'SHIFT_CLOSED',
      brandId: 'brand-1',
      status: 'OPEN',
    });
    await expect(service.current('store-1', at('2026-10-14T12:00:00Z'))).resolves.toEqual({
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
      openedAutomatically: false,
      canExtend: false,
      pausedUntil: null,
      pauseReason: null,
      pauseComment: null,
      pausedByName: null,
    });
  });

  it('says a shift was opened by the schedule, and offers «Продлить» only in the last hour', async () => {
    const { service } = harness({ openShift: { id: 'shift-1' } });
    const morning = await service.current('store-1', at('2026-10-14T12:00:00Z'));
    expect(morning).toMatchObject({ open: true, openedAutomatically: true, openedByName: null, canExtend: false });
    expect((await service.current('store-1', at('2026-10-14T20:05:00Z'))).canExtend).toBe(true);
  });

  describe('opening by the schedule', () => {
    it('opens a shift at the start of the hours, with no person, marked as opened by the schedule', async () => {
      const { service, prisma, realtime, availability } = harness();
      await expect(service.openBySchedule('store-1', at('2026-10-14T09:00:30Z'))).resolves.toBe(true);
      expect(prisma.storeShift.create).toHaveBeenCalledWith({
        data: {
          storeId: 'store-1',
          openedAt: at('2026-10-14T09:00:30Z'),
          openedById: null,
          openedAutomatically: true,
        },
      });
      expect(realtime.emitKdsShiftChanged).toHaveBeenCalled();
      expect(availability.announce).toHaveBeenCalledWith('store-1');
    });

    it('keeps one open around the clock for a store with no hours on file', async () => {
      const { service, prisma } = harness({ hours: [] });
      await expect(service.openBySchedule('store-1', at('2026-10-14T03:00:00Z'))).resolves.toBe(true);
      expect(prisma.storeShift.create).toHaveBeenCalled();
    });

    it('opens nothing outside the hours, for a store switched off, or when one is open', async () => {
      await expect(harness().service.openBySchedule('store-1', at('2026-10-14T08:59:00Z'))).resolves.toBe(false);
      await expect(
        harness({ status: 'CLOSED' }).service.openBySchedule('store-1', at('2026-10-14T12:00:00Z')),
      ).resolves.toBe(false);
      const open = harness({ openShift: { id: 'shift-1' } });
      await expect(open.service.openBySchedule('store-1', at('2026-10-14T12:00:00Z'))).resolves.toBe(false);
      expect(open.prisma.storeShift.create).not.toHaveBeenCalled();
    });

    it('lets another API instance win the race quietly', async () => {
      const { service, prisma, realtime } = harness();
      prisma.storeShift.create.mockRejectedValue(
        new Prisma.PrismaClientKnownRequestError('Unique constraint failed', { code: 'P2002', clientVersion: 'test' }),
      );
      await expect(service.openBySchedule('store-1', at('2026-10-14T12:00:00Z'))).resolves.toBe(false);
      expect(realtime.emitKdsShiftChanged).not.toHaveBeenCalled();
    });
  });

  describe('closing by the schedule', () => {
    const hours = (iso: string) => hoursAround(HOURS, 'UTC', at(iso));
    const openedInTheMorning = { openedAt: at('2026-10-14T09:00:00Z'), extendedUntil: null };

    it('closes exactly at the end of the hours by default, after the grace when one is set', () => {
      expect(autoCloseDue(hours('2026-10-14T20:59:00Z'), openedInTheMorning, 0, at('2026-10-14T20:59:00Z'))).toBe(
        false,
      );
      expect(autoCloseDue(hours('2026-10-14T21:00:00Z'), openedInTheMorning, 0, at('2026-10-14T21:00:00Z'))).toBe(true);
      expect(autoCloseDue(hours('2026-10-14T21:05:00Z'), openedInTheMorning, 600, at('2026-10-14T21:05:00Z'))).toBe(
        false,
      );
    });

    it('waits for a running extension, then closes at its end', () => {
      const extended = { ...openedInTheMorning, extendedUntil: at('2026-10-14T21:30:00Z') };
      expect(autoCloseDue(hours('2026-10-14T21:20:00Z'), extended, 0, at('2026-10-14T21:20:00Z'))).toBe(false);
      expect(autoCloseDue(hours('2026-10-14T21:30:00Z'), extended, 0, at('2026-10-14T21:30:00Z'))).toBe(true);
    });

    it('closes for a lunch break too (the next window reopens it), and never around the clock', () => {
      const split: WorkingHour[] = HOURS.flatMap((h) => [{ ...h, closesAt: 13 * 60 }]);
      const lunch = hoursAround(split, 'UTC', at('2026-10-14T13:01:00Z'));
      expect(autoCloseDue(lunch, openedInTheMorning, 0, at('2026-10-14T13:01:00Z'))).toBe(true);
      const allDay = hoursAround([], 'UTC', at('2026-10-14T03:00:00Z'));
      expect(autoCloseDue(allDay, openedInTheMorning, 0, at('2026-10-14T03:00:00Z'))).toBe(false);
    });

    it('closes whatever is still in work — the board keeps those orders — and asks nothing about them', async () => {
      const { service, prisma } = harness({ openShift: { id: 'shift-1' } });
      await expect(service.closeBySchedule('store-1', 0, at('2026-10-14T21:00:00Z'))).resolves.toBe(true);
      expect(prisma.storeShift.updateMany).toHaveBeenCalledWith({
        where: { id: 'shift-1', closedAt: null },
        data: { closedAt: at('2026-10-14T21:00:00Z'), closedById: null, closedAutomatically: true },
      });
      expect(prisma.order.findMany).not.toHaveBeenCalled();
    });

    it('clears «Загружены» and a pause, tells the team the pause ended, and announces the close', async () => {
      const { service, status, pause, notifications, availability } = harness({
        openShift: { id: 'shift-1' },
        status: 'OVERLOADED',
        pause: { pausedUntil: at('2026-10-14T22:00:00Z'), pauseReason: 'NO_STAFF', pausedById: 'staff-1' },
      });
      await expect(service.closeBySchedule('store-1', 0, at('2026-10-14T21:00:00Z'))).resolves.toBe(true);
      expect(status()).toBe('OPEN');
      expect(pause()).toEqual({ pausedUntil: null, pauseReason: null, pauseComment: null, pausedById: null });
      expect(notifications.notifyStoreTeam).toHaveBeenCalledWith(
        'store-1',
        expect.objectContaining({ title: 'Пауза закончилась · Центр' }),
        { staff: true, owner: true },
      );
      expect(availability.announce).toHaveBeenCalledWith('store-1');
    });

    it('leaves a shift within the hours alone', async () => {
      const { service, prisma } = harness({ openShift: { id: 'shift-1' } });
      await expect(service.closeBySchedule('store-1', 0, at('2026-10-14T20:00:00Z'))).resolves.toBe(false);
      expect(prisma.storeShift.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('«Продлить»', () => {
    it('extends past the closing in the last hour and tells the kitchens and the storefronts', async () => {
      const { service, prisma, realtime, availability } = harness({ openShift: { id: 'shift-1' } });
      await service.extend('store-1', 30, at('2026-10-14T20:30:00Z'));
      expect(prisma.storeShift.updateMany).toHaveBeenCalledWith({
        where: { id: 'shift-1', closedAt: null },
        data: { extendedUntil: at('2026-10-14T21:30:00Z') },
      });
      expect(realtime.emitKdsShiftChanged).toHaveBeenCalled();
      expect(availability.announce).toHaveBeenCalledWith('store-1');
    });

    it('can extend a running extension once the hours are over', async () => {
      const { service, prisma } = harness({
        openShift: { id: 'shift-1', extendedUntil: at('2026-10-14T21:30:00Z') },
      });
      await service.extend('store-1', 60, at('2026-10-14T21:20:00Z'));
      expect(prisma.storeShift.updateMany).toHaveBeenCalledWith({
        where: { id: 'shift-1', closedAt: null },
        data: { extendedUntil: at('2026-10-14T22:30:00Z') },
      });
    });

    it.each([
      ['more than an hour before the closing', { id: 'shift-1' }, '2026-10-14T19:30:00Z', 'TOO_EARLY'],
      [
        'at 23:57, outside the hours — it used to open ASAP ordering at night',
        { id: 'shift-1' },
        '2026-10-14T23:57:00Z',
        'OUTSIDE_HOURS',
      ],
      ['without a shift', null, '2026-10-14T20:30:00Z', 'NO_SHIFT'],
    ] as const)('is refused %s', async (_, openShift, nowIso, reason) => {
      const { service, prisma } = harness({ openShift });
      await expect(service.extend('store-1', 30, at(nowIso))).rejects.toMatchObject({
        status: 409,
        response: { code: 'SHIFT_EXTENSION_NOT_ALLOWED', reason },
      });
      expect(prisma.storeShift.updateMany).not.toHaveBeenCalled();
    });

    it('is refused for a store open around the clock', async () => {
      const { service } = harness({ openShift: { id: 'shift-1' }, hours: [] });
      await expect(service.extend('store-1', 60, at('2026-10-14T20:50:00Z'))).rejects.toMatchObject({
        response: { code: 'SHIFT_EXTENSION_NOT_ALLOWED', reason: 'AROUND_THE_CLOCK' },
      });
    });

    describe('when it may be offered and where it ends', () => {
      const hours = (iso: string) => hoursAround(HOURS, 'UTC', at(iso));
      const shift = (extendedUntil: string | null) => ({
        openedAt: at('2026-10-14T09:00:00Z'),
        extendedUntil: extendedUntil ? at(extendedUntil) : null,
      });

      it('is offered from an hour before the closing and while an extension runs', () => {
        expect(extensionRefusal(hours('2026-10-14T19:59:00Z'), shift(null), at('2026-10-14T19:59:00Z'))).toBe(
          'TOO_EARLY',
        );
        expect(extensionRefusal(hours('2026-10-14T20:00:00Z'), shift(null), at('2026-10-14T20:00:00Z'))).toBeNull();
        expect(
          extensionRefusal(hours('2026-10-14T21:10:00Z'), shift('2026-10-14T21:30:00Z'), at('2026-10-14T21:10:00Z')),
        ).toBeNull();
        expect(
          extensionRefusal(hours('2026-10-14T21:31:00Z'), shift('2026-10-14T21:30:00Z'), at('2026-10-14T21:31:00Z')),
        ).toBe('OUTSIDE_HOURS');
      });

      it('runs from the closing time or the current extension, whichever is later', () => {
        expect(extensionTarget(hours('2026-10-14T20:50:00Z'), shift(null), 30, at('2026-10-14T20:50:00Z'))).toEqual(
          at('2026-10-14T21:30:00Z'),
        );
        expect(
          extensionTarget(hours('2026-10-14T21:20:00Z'), shift('2026-10-14T21:30:00Z'), 60, at('2026-10-14T21:20:00Z')),
        ).toEqual(at('2026-10-14T22:30:00Z'));
      });

      it('stops four hours past the closing', () => {
        const now = at('2026-10-15T00:40:00Z');
        expect(extensionTarget(hours('2026-10-15T00:40:00Z'), shift('2026-10-15T00:50:00Z'), 60, now)).toEqual(
          at('2026-10-15T01:00:00Z'),
        );
        expect(extensionTarget(hours('2026-10-15T00:40:00Z'), shift('2026-10-15T01:00:00Z'), 30, now)).toBe('LIMIT');
        expect(extensionRefusal(hours('2026-10-15T00:40:00Z'), shift('2026-10-15T01:00:00Z'), now)).toBe('LIMIT');
      });
    });
  });

  describe('«Пауза»', () => {
    const noon = at('2026-10-14T12:00:00Z');

    it('pauses for the chosen minutes, tells the team who, why and until when, and announces it', async () => {
      const { service, prisma, notifications, realtime, availability } = harness({ openShift: { id: 'shift-1' } });
      await service.pause('store-1', 'staff-1', { minutes: 30, reason: 'EQUIPMENT', comment: '  кофемашина ' }, noon);
      expect(prisma.store.update).toHaveBeenCalledWith({
        where: { id: 'store-1' },
        data: {
          pausedUntil: at('2026-10-14T12:30:00Z'),
          pauseReason: 'EQUIPMENT',
          pauseComment: 'кофемашина',
          pausedById: 'staff-1',
        },
      });
      expect(notifications.notifyStoreTeam).toHaveBeenCalledWith(
        'store-1',
        {
          title: 'Пауза до 12:30 · Центр',
          body:
            'Сломалось оборудование — кофемашина (Анна). Заказы «сейчас» не принимаются, предзаказы до 12:30 закрыты. / ' +
            'Equipment broke — кофемашина (Анна). No orders for now; pre-orders before 12:30 are closed.',
        },
        { staff: true, owner: true },
      );
      expect(realtime.emitKdsShiftChanged).toHaveBeenCalled();
      expect(availability.announce).toHaveBeenCalledWith('store-1');
    });

    it('carries the pause on the shift, with who set it, while it runs', async () => {
      const { service } = harness({
        openShift: { id: 'shift-1' },
        pause: {
          pausedUntil: at('2026-10-14T12:30:00Z'),
          pauseReason: 'NO_INGREDIENTS',
          pauseComment: 'молоко',
          pausedById: 'staff-1',
        },
      });
      await expect(service.current('store-1', noon)).resolves.toMatchObject({
        pausedUntil: '2026-10-14T12:30:00.000Z',
        pauseReason: 'NO_INGREDIENTS',
        pauseComment: 'молоко',
        pausedByName: 'Анна',
      });
      await expect(service.current('store-1', at('2026-10-14T12:31:00Z'))).resolves.toMatchObject({
        pausedUntil: null,
        pauseReason: null,
        pausedByName: null,
      });
    });

    it('pauses «до конца дня» until the closing, or the extension when that is later', () => {
      const hours = hoursAround(HOURS, 'UTC', noon);
      expect(pauseEnd(hours, null, null, noon, 'UTC')).toEqual(at('2026-10-14T21:00:00Z'));
      const late = at('2026-10-14T20:50:00Z');
      expect(pauseEnd(hoursAround(HOURS, 'UTC', late), at('2026-10-14T21:30:00Z'), null, late, 'UTC')).toEqual(
        at('2026-10-14T21:30:00Z'),
      );
    });

    it('pauses «до конца дня» until local midnight around the clock, and before the opening until its window ends', () => {
      expect(pauseEnd(hoursAround([], 'Europe/Chisinau', noon), null, null, noon, 'Europe/Chisinau')).toEqual(
        at('2026-10-14T21:00:00Z'),
      );
      const early = at('2026-10-14T08:30:00Z');
      expect(pauseEnd(hoursAround(HOURS, 'UTC', early), null, null, early, 'UTC')).toEqual(at('2026-10-14T21:00:00Z'));
    });

    it('is refused for a store switched off', async () => {
      const { service } = harness({ status: 'CLOSED' });
      await expect(service.pause('store-1', 'staff-1', { minutes: 15, reason: 'OTHER' }, noon)).rejects.toMatchObject({
        status: 409,
        response: { code: 'STORE_SWITCHED_OFF' },
      });
    });

    it('is lifted with «Снять паузу», and the team hears it; lifting it again says nothing', async () => {
      const { service, pause, notifications, availability } = harness({
        pause: { pausedUntil: at('2026-10-14T12:30:00Z'), pauseReason: 'OTHER', pausedById: 'staff-2' },
      });
      await service.resume('store-1', 'staff-1', noon);
      expect(pause().pausedUntil).toBeNull();
      expect(notifications.notifyStoreTeam).toHaveBeenCalledWith(
        'store-1',
        expect.objectContaining({ title: 'Пауза снята · Центр' }),
        { staff: true, owner: true },
      );
      expect(availability.announce).toHaveBeenCalledWith('store-1');

      notifications.notifyStoreTeam.mockClear();
      await service.resume('store-1', 'staff-1', noon);
      expect(notifications.notifyStoreTeam).not.toHaveBeenCalled();
    });

    it('ends by itself once it ran out, once', async () => {
      const { service, notifications, availability, pause } = harness({
        pause: { pausedUntil: at('2026-10-14T12:30:00Z'), pauseReason: 'EQUIPMENT', pausedById: 'staff-1' },
      });
      await expect(service.expirePause('store-1', at('2026-10-14T12:29:00Z'))).resolves.toBe(false);
      await expect(service.expirePause('store-1', at('2026-10-14T12:30:00Z'))).resolves.toBe(true);
      expect(pause().pausedUntil).toBeNull();
      expect(notifications.notifyStoreTeam).toHaveBeenCalledWith(
        'store-1',
        {
          title: 'Пауза закончилась · Центр',
          body: 'Точка снова принимает заказы. / The pause is over; the store takes orders again.',
        },
        { staff: true, owner: true },
      );
      expect(availability.announce).toHaveBeenCalledWith('store-1');
      await expect(service.expirePause('store-1', at('2026-10-14T12:31:00Z'))).resolves.toBe(false);
    });
  });

  describe('«Загружены»', () => {
    it('marks the store OVERLOADED and tells the kitchens, the storefronts and the load channel', async () => {
      const { service, realtime, availability, status } = harness({ openShift: { id: 'shift-1' } });
      const shift = await service.setBusy('store-1', true);

      expect(status()).toBe('OVERLOADED');
      expect(shift.busy).toBe(true);
      expect(realtime.emitKdsShiftChanged).toHaveBeenCalledWith({
        storeId: 'store-1',
        shift: expect.objectContaining({ busy: true, open: true }),
      });
      expect(availability.announce).toHaveBeenCalledWith('store-1');
      // Full meter, and the ETA the storefronts show — base, queue, typical cooking.
      expect(realtime.emitStoreLoad).toHaveBeenCalledWith({
        storeId: 'store-1',
        busy: true,
        busyMeter: 100,
        currentEtaSeconds: 780,
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
  });

  it('answers 404 for a store that does not exist', async () => {
    const { service, prisma } = harness();
    prisma.store.findUnique.mockResolvedValue(null as never);
    await expect(service.current('nope')).rejects.toMatchObject({ status: 404 });
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
