import { Injectable, Optional } from '@nestjs/common';
import type { Prisma, StorePauseReason } from '@prisma/client';

import { type StoreAvailability, storeAvailability } from '../catalog/store-availability';
import { PrismaService } from '../prisma/prisma.service';
import { KitchenLoadService } from './kitchen-load.service';
import { hoursAround, type WorkingHour } from './opening-hours';
import { QueuePolicyService } from './queue-policy.service';

/** The store columns {@link StoreAvailabilityService.evaluate} reads; spread into a Prisma `select`. */
export const AVAILABILITY_SELECT = {
  id: true,
  brandId: true,
  status: true,
  timezone: true,
  baseEtaSeconds: true,
  kitchenParallelism: true,
  loadExtraSeconds: true,
  pausedUntil: true,
  pauseReason: true,
  workingHours: { select: { weekday: true, opensAt: true, closesAt: true, isClosed: true } },
  shifts: { where: { closedAt: null }, select: { extendedUntil: true }, take: 1 },
} as const satisfies Prisma.StoreSelect;

/** What the availability of one store is worked out from. */
export interface AvailabilityInput {
  id: string;
  status: string;
  timezone: string;
  baseEtaSeconds: number;
  kitchenParallelism: number;
  /** N of the queue policy; absent reads as its default. */
  loadExtraSeconds?: number | null;
  workingHours: readonly WorkingHour[];
  /** The open shift, if any (`closedAt = null`, at most one row). */
  shifts: ReadonlyArray<{ extendedUntil: Date | null }>;
  /** The kitchen's «Пауза»; absent reads as not paused. */
  pausedUntil?: Date | null;
  pauseReason?: StorePauseReason | null;
}

/** {@link StoreAvailability} plus the ASAP wait the storefronts show. */
export interface StoreAvailabilityView extends StoreAvailability {
  /**
   * Seconds until an ASAP order placed now would be ready: base time, the
   * queue, a typical order's cooking, and the spill into a later slot.
   */
  currentEtaSeconds: number;
  /** Why the store is paused, while it is; null otherwise. */
  pauseReason: StorePauseReason | null;
}

/**
 * Applies the availability rules (catalog/store-availability.ts) to stores
 * from the database: the hours in their timezone, the open shift and its
 * extension, the kitchen's pause, and the live queue — for many stores in
 * one round trip.
 */
@Injectable()
export class StoreAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kitchen: KitchenLoadService,
    /** Always provided by KitchenModule; unit tests written before the queue policy leave it out (= off). */
    @Optional() private readonly queue?: QueuePolicyService,
  ) {}

  async evaluate(
    stores: readonly AvailabilityInput[],
    now: Date = new Date(),
  ): Promise<Map<string, StoreAvailabilityView>> {
    const result = new Map<string, StoreAvailabilityView>();
    if (stores.length === 0) return result;
    if (this.queue?.enabled) return this.evaluateQueued(stores, now);
    const policy = this.kitchen.policy;
    const quotes = await this.kitchen.asapByStore(stores, now);
    for (const store of stores) {
      const quote = quotes.get(store.id);
      const availability = storeAvailability(
        {
          status: store.status,
          openShift: store.shifts[0] ?? null,
          asapWaitSeconds: quote && !quote.queueFull ? quote.etaSeconds : null,
          pausedUntil: store.pausedUntil ?? null,
        },
        now,
        policy,
        // A day back finds the window `now` is in; eight ahead find the next opening.
        hoursAround(store.workingHours, store.timezone, now, { backDays: 1 }),
      );
      result.set(store.id, {
        ...availability,
        currentEtaSeconds: quote?.etaSeconds ?? store.baseEtaSeconds,
        pauseReason: availability.pausedUntil ? (store.pauseReason ?? null) : null,
      });
    }
    return result;
  }

  /**
   * The same rules under the queue policy (`QUEUE_POLICY_ENABLED`): the wait
   * is G of one typical position placed now at the end of the store's queue
   * (docs/queue-policy.md 2.3) — the store's «N мин», and what decides
   * `CLOSING_SOON` and `QUEUE_FULL` for an order for now.
   */
  private async evaluateQueued(
    stores: readonly AvailabilityInput[],
    now: Date,
  ): Promise<Map<string, StoreAvailabilityView>> {
    const result = new Map<string, StoreAvailabilityView>();
    const policy = this.kitchen.policy;
    const quotes = (await this.queue?.typicalQuotes(stores, now)) ?? new Map();
    for (const store of stores) {
      const quote = quotes.get(store.id);
      const wait = quote ? Math.max(0, Math.ceil((quote.readyAt - now.getTime()) / 1000)) : null;
      const availability = storeAvailability(
        {
          status: store.status,
          openShift: store.shifts[0] ?? null,
          asapWaitSeconds: wait,
          pausedUntil: store.pausedUntil ?? null,
        },
        now,
        policy,
        hoursAround(store.workingHours, store.timezone, now, { backDays: 1 }),
      );
      result.set(store.id, {
        ...availability,
        currentEtaSeconds: wait ?? store.baseEtaSeconds,
        pauseReason: availability.pausedUntil ? (store.pauseReason ?? null) : null,
      });
    }
    return result;
  }

  /** One store by id; null when there is no such store. */
  async forStore(
    storeId: string,
    now: Date = new Date(),
  ): Promise<(StoreAvailabilityView & { brandId: string; status: string }) | null> {
    const store = await this.prisma.store.findUnique({ where: { id: storeId }, select: AVAILABILITY_SELECT });
    if (!store) return null;
    const view = (await this.evaluate([store], now)).get(store.id);
    return view ? { ...view, brandId: store.brandId, status: store.status } : null;
  }
}
