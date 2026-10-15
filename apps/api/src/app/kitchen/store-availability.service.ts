import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';

import { type StoreAvailability, storeAvailability } from '../catalog/store-availability';
import { PrismaService } from '../prisma/prisma.service';
import { KitchenLoadService } from './kitchen-load.service';
import { hoursAround, type WorkingHour } from './opening-hours';

/** The store columns {@link StoreAvailabilityService.evaluate} reads; spread into a Prisma `select`. */
export const AVAILABILITY_SELECT = {
  id: true,
  brandId: true,
  status: true,
  timezone: true,
  baseEtaSeconds: true,
  kitchenParallelism: true,
  slotCapacity: true,
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
  slotCapacity: number;
  workingHours: readonly WorkingHour[];
  /** The open shift, if any (`closedAt = null`, at most one row). */
  shifts: ReadonlyArray<{ extendedUntil: Date | null }>;
}

/** {@link StoreAvailability} plus the ASAP wait the storefronts show. */
export interface StoreAvailabilityView extends StoreAvailability {
  /** Seconds until an ASAP order placed now would be ready — the spill into a later slot included. */
  currentEtaSeconds: number;
}

/**
 * Applies the availability rules (catalog/store-availability.ts) to stores
 * from the database: the hours in their timezone, the open shift and its
 * extension, and the live queue — for many stores in one round trip.
 */
@Injectable()
export class StoreAvailabilityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly kitchen: KitchenLoadService,
  ) {}

  async evaluate(
    stores: readonly AvailabilityInput[],
    now: Date = new Date(),
  ): Promise<Map<string, StoreAvailabilityView>> {
    const result = new Map<string, StoreAvailabilityView>();
    if (stores.length === 0) return result;
    const policy = this.kitchen.policy;
    const quotes = await this.kitchen.asapByStore(stores, now);
    for (const store of stores) {
      const quote = quotes.get(store.id);
      const availability = storeAvailability(
        {
          status: store.status,
          openShift: store.shifts[0] ?? null,
          asapWaitSeconds: quote && !quote.queueFull ? quote.etaSeconds : null,
        },
        now,
        policy,
        // A day back finds the window `now` is in; eight ahead find the next opening.
        hoursAround(store.workingHours, store.timezone, now, { backDays: 1 }),
      );
      result.set(store.id, { ...availability, currentEtaSeconds: quote?.etaSeconds ?? store.baseEtaSeconds });
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
