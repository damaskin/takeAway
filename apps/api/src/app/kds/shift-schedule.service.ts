import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { hoursAround, withinHours } from '../kitchen/opening-hours';
import { AVAILABILITY_SELECT, StoreAvailabilityService } from '../kitchen/store-availability.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { DEFAULT_AUTO_CLOSE_GRACE_MINUTES, StoreShiftService } from './store-shift.service';

/** The two availability flags clients act on. */
interface SeenState {
  acceptingOrders: boolean;
  openNow: boolean;
}

/** What one pass did. */
export interface SchedulePass {
  opened: number;
  closed: number;
  pausesEnded: number;
  announced: number;
}

/**
 * The clock side of the shift (docs/kitchen-policy.md, section F), every
 * minute. Since 2026-10-20 the shift follows the working hours by itself:
 *
 * - a kitchen pause that ran out ends («Пауза закончилась» to the team);
 * - the shift closes exactly at the end of the working hours or of the
 *   kitchen's extension (`AUTO_CLOSE_GRACE_MINUTES` after it, 0 by
 *   default), whatever orders are still in work — they stay on the board;
 * - a shift opens at the start of each window for every store that is not
 *   switched off; a store open around the clock (or with no hours on file)
 *   keeps one open;
 * - clients hear when a store's availability changed by itself: the hours
 *   or an extension started or ended, the queue filled up or drained.
 *   `store.availabilityChanged` keeps its fixed payload; kitchen screens of
 *   a store with a shift open also get a fresh `kds.shiftChanged`.
 *
 * Every step announces what it changed itself, and the last one skips those
 * stores. What it last saw is kept in memory, so after a restart the first
 * pass only takes note; a second API instance announcing the same change
 * again is harmless — clients just refetch the store. Opening and closing
 * are claimed in the database, so two instances never open two shifts.
 */
@Injectable()
export class ShiftScheduleService {
  private readonly logger = new Logger(ShiftScheduleService.name);
  private readonly seen = new Map<string, SeenState>();
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly shifts: StoreShiftService,
    private readonly availability: StoreAvailabilityService,
    private readonly realtime: RealtimeGateway,
  ) {}

  /** `AUTO_CLOSE_GRACE_MINUTES` (0 by default: right at the end of the hours), in seconds. */
  get autoCloseGraceSeconds(): number {
    const raw = this.config.get<string | number>('AUTO_CLOSE_GRACE_MINUTES');
    const value = typeof raw === 'string' && raw.trim() !== '' ? Number(raw) : raw;
    const minutes =
      typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : DEFAULT_AUTO_CLOSE_GRACE_MINUTES;
    return minutes * 60;
  }

  @Cron(CronExpression.EVERY_MINUTE, { name: 'kitchen-shift-schedule' })
  async tick(): Promise<void> {
    // A slow pass must not overlap the next one.
    if (this.running) return;
    this.running = true;
    try {
      await this.sweep(new Date());
    } catch (err) {
      this.logger.error(`Shift schedule pass failed: ${(err as Error).message}`);
    } finally {
      this.running = false;
    }
  }

  async sweep(now: Date): Promise<SchedulePass> {
    const pausesEnded = await this.endPauses(now);
    const closed = await this.autoClose(now);
    const opened = await this.autoOpen(now);
    const handled = new Set([...pausesEnded, ...closed, ...opened]);

    const stores = await this.prisma.store.findMany({
      where: { status: { not: 'CLOSED' }, brand: { moderationStatus: 'APPROVED' } },
      select: AVAILABILITY_SELECT,
    });
    const views = await this.availability.evaluate(stores, now);

    let announced = 0;
    const present = new Set<string>();
    for (const store of stores) {
      present.add(store.id);
      const view = views.get(store.id);
      if (!view) continue;
      const state: SeenState = { acceptingOrders: view.acceptingOrders, openNow: view.openNow };
      const before = this.seen.get(store.id);
      this.seen.set(store.id, state);
      // An open, a close or a pause that ended already announced itself.
      if (!before || handled.has(store.id)) continue;
      if (before.acceptingOrders === state.acceptingOrders && before.openNow === state.openNow) continue;

      this.realtime.emitStoreAvailabilityChanged({
        storeId: store.id,
        brandId: store.brandId,
        acceptingOrders: state.acceptingOrders,
      });
      if (store.shifts.length > 0) {
        this.realtime.emitKdsShiftChanged({ storeId: store.id, shift: await this.shifts.current(store.id, now) });
      }
      announced += 1;
    }
    for (const id of [...this.seen.keys()]) if (!present.has(id)) this.seen.delete(id);

    return { opened: opened.size, closed: closed.size, pausesEnded: pausesEnded.size, announced };
  }

  /** Pauses that ran out by now. */
  private async endPauses(now: Date): Promise<Set<string>> {
    const due = await this.prisma.store.findMany({ where: { pausedUntil: { lte: now } }, select: { id: true } });
    return this.each(due, 'end the pause of', (storeId) => this.shifts.expirePause(storeId, now));
  }

  /** Open shifts whose hours (and extension) are over. */
  private async autoClose(now: Date): Promise<Set<string>> {
    const open = await this.prisma.storeShift.findMany({ where: { closedAt: null }, select: { storeId: true } });
    const grace = this.autoCloseGraceSeconds;
    return this.each(
      open.map((s) => ({ id: s.storeId })),
      'close the shift of',
      (storeId) => this.shifts.closeBySchedule(storeId, grace, now),
    );
  }

  /** Stores that are not switched off, have no shift open and are within their hours (or open around the clock). */
  private async autoOpen(now: Date): Promise<Set<string>> {
    const stores = await this.prisma.store.findMany({
      where: { status: { not: 'CLOSED' }, shifts: { none: { closedAt: null } } },
      select: {
        id: true,
        timezone: true,
        workingHours: { select: { weekday: true, opensAt: true, closesAt: true, isClosed: true } },
      },
    });
    const due = stores.filter((s) =>
      withinHours(hoursAround(s.workingHours, s.timezone, now, { backDays: 1, aheadDays: 1 }), now),
    );
    return this.each(due, 'open the shift of', (storeId) => this.shifts.openBySchedule(storeId, now));
  }

  /** Runs one step per store; one store must not stop the others — the next pass tries again. */
  private async each(
    stores: ReadonlyArray<{ id: string }>,
    what: string,
    step: (storeId: string) => Promise<boolean>,
  ): Promise<Set<string>> {
    const done = new Set<string>();
    for (const { id } of stores) {
      try {
        if (await step(id)) done.add(id);
      } catch (err) {
        this.logger.error(`Could not ${what} store ${id} by schedule: ${(err as Error).message}`);
      }
    }
    return done;
  }
}
