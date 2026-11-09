import { Injectable, Logger } from '@nestjs/common';

import { busyMeterOf, isBusy } from '../catalog/store-availability';
import { QueuePolicyService } from '../kitchen/queue-policy.service';
import { QUEUE_STALE_SECONDS, QUEUE_STATUSES } from '../kitchen/queue-state';
import { StoreAvailabilityService } from '../kitchen/store-availability.service';
import { PrismaService } from '../prisma/prisma.service';
import { RealtimeGateway } from '../realtime/realtime.gateway';

const MINUTE_MS = 60_000;

/** The kitchen's new estimate for an order, from the queue's G (null: the promise holds). */
export function estimateFor(
  order: { pickupAt: Date },
  readyAt: number,
  now: Date,
): { change: false } | { change: true; readyEstimateAt: Date | null } {
  // An order past its own plan is ready «now» by the calculator every
  // minute; moving its estimate along with the clock would hide the delay
  // («Немного задерживаемся» runs off the estimate) and ping the customer
  // every minute. It keeps the estimate it had.
  if (readyAt - now.getTime() < MINUTE_MS) return { change: false };
  if (Math.abs(readyAt - order.pickupAt.getTime()) < MINUTE_MS) return { change: true, readyEstimateAt: null };
  return { change: true, readyEstimateAt: new Date(Math.ceil(readyAt / 1000) * 1000) };
}

/** Whether two estimates differ by a minute or more (or one of them is none). */
function moved(current: Date | null, next: Date | null): boolean {
  if (!current || !next) return current !== next;
  return Math.abs(current.getTime() - next.getTime()) >= MINUTE_MS;
}

/**
 * Keeps the customers' ready times in step with the queue (docs/queue-policy.md
 * 2.3, spec section 5), under `QUEUE_POLICY_ENABLED`: after a new order, an
 * accept, a start, «Готово», a cancel or an expiry — and once a minute from
 * the `kitchen-order-sla` cron — the store's queue is laid out again and
 * every order whose G moved by a minute or more gets it as
 * `readyEstimateAt` (null when G is the promised `pickupAt` again). The
 * customer's apps re-read the order on the `order.statusChanged` sent for it
 * and count down to `readyEstimateAt ?? pickupAt`. The store's «N мин» goes
 * out as `store.loadChanged` when it changed.
 */
@Injectable()
export class QueueRecomputeService {
  private readonly logger = new Logger(QueueRecomputeService.name);
  /** The store's «N мин» last announced, per store (one per API instance). */
  private readonly announcedMinutes = new Map<string, number>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeGateway,
    private readonly queue: QueuePolicyService,
    private readonly availability: StoreAvailabilityService,
  ) {}

  /** Recompute in the background: the caller's own answer does not wait for it. */
  touch(storeId: string): void {
    if (!this.queue.enabled) return;
    void this.run(storeId);
  }

  /** Recompute now; failures are logged, never thrown. Returns the number of estimates moved. */
  async run(storeId: string, now: Date = new Date()): Promise<number> {
    if (!this.queue.enabled) return 0;
    try {
      return await this.recompute(storeId, now);
    } catch (err) {
      this.logger.warn(`Queue recompute for store ${storeId} failed: ${(err as Error).message}`);
      return 0;
    }
  }

  /** Every store with orders in its queue — the once-a-minute pass. */
  async runActiveStores(now: Date = new Date()): Promise<number> {
    if (!this.queue.enabled) return 0;
    const stores = await this.prisma.order.findMany({
      where: {
        status: { in: QUEUE_STATUSES },
        pickupAt: { gte: new Date(now.getTime() - QUEUE_STALE_SECONDS * 1000) },
      },
      distinct: ['storeId'],
      select: { storeId: true },
    });
    let moved = 0;
    for (const { storeId } of stores) moved += await this.run(storeId, now);
    return moved;
  }

  private async recompute(storeId: string, now: Date): Promise<number> {
    const { schedule, rows } = await this.queue.schedule(storeId, now);
    const byId = new Map(rows.map((row) => [row.id, row]));
    let count = 0;
    for (const planned of schedule.orders) {
      const row = byId.get(planned.id);
      if (!row) continue;
      const estimate = estimateFor(row, planned.readyAt, now);
      if (!estimate.change || !moved(row.readyEstimateAt, estimate.readyEstimateAt)) continue;
      // Only while it is still in the queue: an order handed over in the meantime keeps what it had.
      const updated = await this.prisma.order.updateMany({
        where: { id: row.id, status: { in: QUEUE_STATUSES } },
        data: { readyEstimateAt: estimate.readyEstimateAt },
      });
      if (updated.count === 0) continue;
      count += 1;
      this.realtime.emitOrderStatusChanged(
        {
          orderId: row.id,
          status: row.status,
          etaSeconds: Math.max(0, Math.ceil((planned.readyAt - now.getTime()) / 1000)),
          occurredAt: now.toISOString(),
        },
        row.userId,
      );
    }
    await this.announceLoad(storeId, now);
    return count;
  }

  /** `store.loadChanged` when the store's «N мин» is not the one last announced. */
  private async announceLoad(storeId: string, now: Date): Promise<void> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { status: true, busyMeter: true },
    });
    const view = store ? await this.availability.forStore(storeId, now) : null;
    if (!store || !view) return;
    const minutes = Math.ceil(view.currentEtaSeconds / 60);
    if (this.announcedMinutes.get(storeId) === minutes) return;
    this.announcedMinutes.set(storeId, minutes);
    this.realtime.emitStoreLoad({
      storeId,
      busy: isBusy(store),
      busyMeter: busyMeterOf(store),
      currentEtaSeconds: view.currentEtaSeconds,
    });
  }
}
