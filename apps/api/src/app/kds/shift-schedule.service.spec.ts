import type { ConfigService } from '@nestjs/config';

import type { WorkingHour } from '../kitchen/opening-hours';
import type { StoreAvailabilityService } from '../kitchen/store-availability.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import { ShiftScheduleService } from './shift-schedule.service';
import type { StoreShiftService } from './store-shift.service';

const at = (iso: string) => new Date(iso);

/** 09:00–21:00 every day, UTC. */
const HOURS: WorkingHour[] = [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
  weekday,
  opensAt: 9 * 60,
  closesAt: 21 * 60,
  isClosed: false,
}));

function harness(
  env: Record<string, string> = {},
  shiftless: Array<{ id: string; timezone: string; workingHours: WorkingHour[] }> = [],
) {
  const stores = [
    { id: 'store-1', brandId: 'brand-1', shifts: [{ extendedUntil: null }] },
    { id: 'store-2', brandId: 'brand-1', shifts: [] },
  ];
  let paused: Array<{ id: string }> = [];
  const prisma = {
    store: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        if ('pausedUntil' in where) return paused;
        if ('shifts' in where) return shiftless;
        return stores;
      }),
    },
    storeShift: { findMany: jest.fn().mockResolvedValue([{ storeId: 'store-1' }]) },
  };
  let state = new Map<string, { acceptingOrders: boolean; openNow: boolean }>([
    ['store-1', { acceptingOrders: true, openNow: true }],
    ['store-2', { acceptingOrders: true, openNow: false }],
  ]);
  const availability = { evaluate: jest.fn(async () => state) };
  const shifts = {
    closeBySchedule: jest.fn().mockResolvedValue(false),
    openBySchedule: jest.fn().mockResolvedValue(false),
    expirePause: jest.fn().mockResolvedValue(false),
    current: jest.fn().mockResolvedValue({ storeId: 'store-1', open: true }),
  };
  const realtime = { emitStoreAvailabilityChanged: jest.fn(), emitKdsShiftChanged: jest.fn() };
  const config = { get: (key: string) => env[key] } as unknown as ConfigService;
  const service = new ShiftScheduleService(
    prisma as unknown as PrismaService,
    config,
    shifts as unknown as StoreShiftService,
    availability as unknown as StoreAvailabilityService,
    realtime as unknown as RealtimeGateway,
  );
  const setState = (next: typeof state) => {
    state = next;
  };
  const setPaused = (ids: string[]) => {
    paused = ids.map((id) => ({ id }));
  };
  return { service, prisma, shifts, realtime, setState, setPaused };
}

const NOTHING = { opened: 0, closed: 0, pausesEnded: 0, announced: 0 };

describe('ShiftScheduleService', () => {
  it('takes note on the first pass and announces only what changed afterwards', async () => {
    const { service, realtime, shifts, setState } = harness();

    await expect(service.sweep(at('2026-10-14T20:59:00Z'))).resolves.toEqual(NOTHING);
    expect(realtime.emitStoreAvailabilityChanged).not.toHaveBeenCalled();

    // The queue filled up at store-1: ASAP stops, pre-orders go on.
    setState(
      new Map([
        ['store-1', { acceptingOrders: true, openNow: false }],
        ['store-2', { acceptingOrders: true, openNow: false }],
      ]),
    );
    await expect(service.sweep(at('2026-10-14T21:00:00Z'))).resolves.toEqual({ ...NOTHING, announced: 1 });
    expect(realtime.emitStoreAvailabilityChanged).toHaveBeenCalledWith({
      storeId: 'store-1',
      brandId: 'brand-1',
      acceptingOrders: true,
    });
    // Its kitchen hears it too, so the board flips without a reload.
    expect(shifts.current).toHaveBeenCalledWith('store-1', at('2026-10-14T21:00:00Z'));
    expect(realtime.emitKdsShiftChanged).toHaveBeenCalledWith({
      storeId: 'store-1',
      shift: { storeId: 'store-1', open: true },
    });
  });

  it('closes shifts right at the end of the hours by default, and does not announce them twice', async () => {
    const { service, shifts, realtime, setState } = harness();
    await service.sweep(at('2026-10-14T20:59:00Z'));

    shifts.closeBySchedule.mockResolvedValue(true);
    setState(
      new Map([
        ['store-1', { acceptingOrders: true, openNow: false }],
        ['store-2', { acceptingOrders: true, openNow: false }],
      ]),
    );
    await expect(service.sweep(at('2026-10-14T21:00:00Z'))).resolves.toEqual({ ...NOTHING, closed: 1 });
    expect(shifts.closeBySchedule).toHaveBeenCalledWith('store-1', 0, at('2026-10-14T21:00:00Z'));
    expect(realtime.emitStoreAvailabilityChanged).not.toHaveBeenCalled();
  });

  it('reads the grace from AUTO_CLOSE_GRACE_MINUTES, 0 when unset or nonsense', () => {
    expect(harness().service.autoCloseGraceSeconds).toBe(0);
    expect(harness({ AUTO_CLOSE_GRACE_MINUTES: '5' }).service.autoCloseGraceSeconds).toBe(300);
    expect(harness({ AUTO_CLOSE_GRACE_MINUTES: 'soon' }).service.autoCloseGraceSeconds).toBe(0);
  });

  it('opens shifts only for stores within their hours or open around the clock', async () => {
    const { service, shifts } = harness({}, [
      { id: 'morning', timezone: 'UTC', workingHours: HOURS },
      { id: 'all-day', timezone: 'UTC', workingHours: [] },
    ]);
    shifts.openBySchedule.mockResolvedValue(true);

    await expect(service.sweep(at('2026-10-14T08:59:00Z'))).resolves.toMatchObject({ opened: 1 });
    expect(shifts.openBySchedule).toHaveBeenCalledTimes(1);
    expect(shifts.openBySchedule).toHaveBeenCalledWith('all-day', at('2026-10-14T08:59:00Z'));

    shifts.openBySchedule.mockClear();
    await expect(service.sweep(at('2026-10-14T09:00:00Z'))).resolves.toMatchObject({ opened: 2 });
    expect(shifts.openBySchedule).toHaveBeenCalledWith('morning', at('2026-10-14T09:00:00Z'));
  });

  it('ends pauses that ran out before closing shifts, and announces those stores once', async () => {
    const { service, shifts, realtime, setPaused, setState } = harness();
    await service.sweep(at('2026-10-14T12:00:00Z'));

    setPaused(['store-1']);
    shifts.expirePause.mockResolvedValue(true);
    setState(
      new Map([
        ['store-1', { acceptingOrders: true, openNow: true }],
        ['store-2', { acceptingOrders: true, openNow: true }],
      ]),
    );
    await expect(service.sweep(at('2026-10-14T12:30:00Z'))).resolves.toEqual({
      ...NOTHING,
      pausesEnded: 1,
      announced: 1,
    });
    expect(shifts.expirePause).toHaveBeenCalledWith('store-1', at('2026-10-14T12:30:00Z'));
    // store-2 changed by itself; store-1 announced its own end of the pause.
    expect(realtime.emitStoreAvailabilityChanged).toHaveBeenCalledTimes(1);
    expect(realtime.emitStoreAvailabilityChanged).toHaveBeenCalledWith(expect.objectContaining({ storeId: 'store-2' }));
  });

  it('keeps going when one store fails', async () => {
    const { service, shifts } = harness({}, [{ id: 'all-day', timezone: 'UTC', workingHours: [] }]);
    shifts.closeBySchedule.mockRejectedValue(new Error('deadlock'));
    shifts.openBySchedule.mockRejectedValue(new Error('deadlock'));
    await expect(service.sweep(at('2026-10-14T21:30:00Z'))).resolves.toEqual(NOTHING);
  });
});
