import type { ConfigService } from '@nestjs/config';

import type { StoreAvailabilityService } from '../kitchen/store-availability.service';
import type { PrismaService } from '../prisma/prisma.service';
import type { RealtimeGateway } from '../realtime/realtime.gateway';
import { ShiftScheduleService } from './shift-schedule.service';
import type { StoreShiftService } from './store-shift.service';

const at = (iso: string) => new Date(iso);

function harness(env: Record<string, string> = {}) {
  const stores = [
    { id: 'store-1', brandId: 'brand-1', shifts: [{ extendedUntil: null }] },
    { id: 'store-2', brandId: 'brand-1', shifts: [] },
  ];
  const prisma = {
    store: { findMany: jest.fn().mockResolvedValue(stores) },
    storeShift: { findMany: jest.fn().mockResolvedValue([{ storeId: 'store-1' }]) },
  };
  let state = new Map<string, { acceptingOrders: boolean; openNow: boolean }>([
    ['store-1', { acceptingOrders: true, openNow: true }],
    ['store-2', { acceptingOrders: true, openNow: false }],
  ]);
  const availability = { evaluate: jest.fn(async () => state) };
  const shifts = {
    closeBySchedule: jest.fn().mockResolvedValue(false),
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
  return { service, prisma, shifts, realtime, setState };
}

describe('ShiftScheduleService', () => {
  it('takes note on the first pass and announces only what changed afterwards', async () => {
    const { service, realtime, shifts, setState } = harness();

    await expect(service.sweep(at('2026-10-14T20:59:00Z'))).resolves.toEqual({ closed: 0, announced: 0 });
    expect(realtime.emitStoreAvailabilityChanged).not.toHaveBeenCalled();

    // 21:00: the hours of store-1 are over — ASAP stops, pre-orders go on.
    setState(
      new Map([
        ['store-1', { acceptingOrders: true, openNow: false }],
        ['store-2', { acceptingOrders: true, openNow: false }],
      ]),
    );
    await expect(service.sweep(at('2026-10-14T21:00:00Z'))).resolves.toEqual({ closed: 0, announced: 1 });
    expect(realtime.emitStoreAvailabilityChanged).toHaveBeenCalledWith({
      storeId: 'store-1',
      brandId: 'brand-1',
      acceptingOrders: true,
    });
    // Its kitchen hears it too, so the banner flips without a reload.
    expect(shifts.current).toHaveBeenCalledWith('store-1', at('2026-10-14T21:00:00Z'));
    expect(realtime.emitKdsShiftChanged).toHaveBeenCalledWith({
      storeId: 'store-1',
      shift: { storeId: 'store-1', open: true },
    });
  });

  it('closes shifts by the schedule with the configured grace, and does not announce them twice', async () => {
    const { service, shifts, realtime, setState } = harness({ AUTO_CLOSE_GRACE_MINUTES: '5' });
    await service.sweep(at('2026-10-14T21:00:00Z'));

    shifts.closeBySchedule.mockResolvedValue(true);
    setState(
      new Map([
        ['store-1', { acceptingOrders: true, openNow: false }],
        ['store-2', { acceptingOrders: true, openNow: false }],
      ]),
    );
    await expect(service.sweep(at('2026-10-14T21:05:00Z'))).resolves.toEqual({ closed: 1, announced: 0 });
    expect(shifts.closeBySchedule).toHaveBeenCalledWith('store-1', 300, at('2026-10-14T21:05:00Z'));
    expect(realtime.emitStoreAvailabilityChanged).not.toHaveBeenCalled();
  });

  it('defaults the grace to 10 minutes', () => {
    expect(harness().service.autoCloseGraceSeconds).toBe(600);
    expect(harness({ AUTO_CLOSE_GRACE_MINUTES: '0' }).service.autoCloseGraceSeconds).toBe(0);
    expect(harness({ AUTO_CLOSE_GRACE_MINUTES: 'soon' }).service.autoCloseGraceSeconds).toBe(600);
  });

  it('keeps going when one store fails to close', async () => {
    const { service, shifts } = harness();
    shifts.closeBySchedule.mockRejectedValue(new Error('deadlock'));
    await expect(service.sweep(at('2026-10-14T21:30:00Z'))).resolves.toEqual({ closed: 0, announced: 0 });
  });
});
