import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';

import { AVAILABILITY_SELECT, StoreAvailabilityService } from '../kitchen/store-availability.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';
import { DEFAULT_AUTO_CLOSE_GRACE_MINUTES, StoreShiftService } from './store-shift.service';

/** The two availability flags clients act on. */
interface SeenState {
  acceptingOrders: boolean;
  openNow: boolean;
}

/**
 * The clock side of the shift (docs/kitchen-policy.md, section F), every
 * minute:
 *
 * - closes a shift nobody finished once the working hours (and any
 *   extension) are over — StoreShiftService.closeBySchedule has the rule;
 * - tells clients when a store's availability changed by itself: the hours
 *   or an extension started or ended, the queue filled up or drained.
 *   `store.availabilityChanged` keeps its fixed payload; kitchen screens of a
 *   store with a shift open also get a fresh `kds.shiftChanged`.
 *
 * What it last saw is kept in memory, so after a restart the first pass only
 * takes note; a second API instance announcing the same change again is
 * harmless — clients just refetch the store.
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

  /** `AUTO_CLOSE_GRACE_MINUTES` (10 by default; 0 closes right at the end of the hours), in seconds. */
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

  async sweep(now: Date): Promise<{ closed: number; announced: number }> {
    const closedStores = await this.autoClose(now);

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
      // The close already announced itself.
      if (!before || closedStores.has(store.id)) continue;
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

    return { closed: closedStores.size, announced };
  }

  private async autoClose(now: Date): Promise<Set<string>> {
    const closed = new Set<string>();
    const open = await this.prisma.storeShift.findMany({ where: { closedAt: null }, select: { storeId: true } });
    const grace = this.autoCloseGraceSeconds;
    for (const { storeId } of open) {
      try {
        if (await this.shifts.closeBySchedule(storeId, grace, now)) closed.add(storeId);
      } catch (err) {
        // One store must not stop the others; the next pass tries again.
        this.logger.error(`Could not close the shift of store ${storeId} by schedule: ${(err as Error).message}`);
      }
    }
    return closed;
  }
}
