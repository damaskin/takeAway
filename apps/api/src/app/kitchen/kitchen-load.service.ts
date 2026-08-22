import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';

/**
 * Orders that still owe the kitchen work. CREATED and PAID are queued but
 * untouched; ACCEPTED and IN_PROGRESS are being worked. READY is excluded —
 * it is made, it is on the shelf, it costs nobody anything.
 */
const QUEUEING_STATUSES: OrderStatus[] = [
  OrderStatus.CREATED,
  OrderStatus.PAID,
  OrderStatus.ACCEPTED,
  OrderStatus.IN_PROGRESS,
];

/** Granularity of a scheduled pickup slot. */
export const SLOT_MINUTES = 15;
const SLOT_MS = SLOT_MINUTES * 60 * 1000;

/** How far ahead checkout offers scheduled slots. */
const SLOT_HORIZON_HOURS = 12;

/**
 * An order already in progress has, on average, burned half its work by the
 * time we look. Counting it whole would inflate every quote during a rush;
 * ignoring it would understate the wait. Half is the honest middle, and it
 * is cheap — no per-order timing bookkeeping.
 */
const IN_PROGRESS_WORK_FACTOR = 0.5;

export interface EtaQuote {
  /** Total seconds from now until handover. */
  etaSeconds: number;
  /** Of which, waiting for the queue to clear. */
  queueWaitSeconds: number;
  /** Of which, this order's own preparation. */
  prepSeconds: number;
  /** Fixed store overhead folded in. */
  baseEtaSeconds: number;
}

export interface PickupSlot {
  /** Slot start, UTC. */
  startsAt: Date;
  endsAt: Date;
  /** Orders already promised in this slot. */
  taken: number;
  capacity: number;
  available: boolean;
}

export interface StoreCapacity {
  baseEtaSeconds: number;
  kitchenParallelism: number;
  slotCapacity: number;
}

/**
 * Works out when an order will actually be ready.
 *
 * The product's whole promise is "come at the time we tell you and it is
 * waiting for you". That only holds if the number we quote reflects the
 * queue the customer is joining, so the wait is derived from the work
 * outstanding at the store rather than read off a field nobody updates:
 *
 *     eta = baseEtaSeconds + outstandingWork / kitchenParallelism + ownPrep
 *
 * `outstandingWork` sums `Order.workSeconds` (the whole order's cost to the
 * kitchen), while `ownPrep` uses `prepSeconds` (the longest single item).
 * Those are deliberately different numbers: a four-drink order occupies the
 * bar four times as long as it makes its own customer wait.
 *
 * Slots are the other half. A quote nobody can honour is worse than no
 * quote, so once a 15-minute window holds `slotCapacity` handovers it stops
 * being offered — the rush spills into the next window instead of into
 * everybody's ETA.
 */
@Injectable()
export class KitchenLoadService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Seconds of kitchen work outstanding at a store right now, divided by how
   * many orders it runs in parallel.
   */
  async queueWaitSeconds(storeId: string, parallelism: number): Promise<number> {
    const byStore = await this.queueWaitByStore([{ id: storeId, kitchenParallelism: parallelism }]);
    return byStore.get(storeId) ?? 0;
  }

  /**
   * Same figure for many stores in one round trip. The storefront lists
   * every nearby store with a live wait, so the per-store version would turn
   * one screen into a query per pin on the map.
   */
  async queueWaitByStore(stores: readonly { id: string; kitchenParallelism: number }[]): Promise<Map<string, number>> {
    const waits = new Map<string, number>(stores.map((s) => [s.id, 0]));
    if (stores.length === 0) return waits;

    const rows = await this.prisma.order.groupBy({
      by: ['storeId', 'status'],
      where: { storeId: { in: stores.map((s) => s.id) }, status: { in: QUEUEING_STATUSES } },
      _sum: { workSeconds: true },
    });

    const work = new Map<string, number>();
    for (const row of rows) {
      const factor = row.status === OrderStatus.IN_PROGRESS ? IN_PROGRESS_WORK_FACTOR : 1;
      work.set(row.storeId, (work.get(row.storeId) ?? 0) + (row._sum.workSeconds ?? 0) * factor);
    }

    for (const store of stores) {
      waits.set(store.id, Math.round((work.get(store.id) ?? 0) / Math.max(1, store.kitchenParallelism)));
    }
    return waits;
  }

  /**
   * Quote an ASAP order. `prepSeconds` is the caller's own preparation time
   * — from the cart being priced, or from the order being created.
   */
  async quote(storeId: string, prepSeconds: number): Promise<EtaQuote> {
    const store = await this.capacityFor(storeId);
    const queueWaitSeconds = await this.queueWaitSeconds(storeId, store.kitchenParallelism);
    return {
      etaSeconds: store.baseEtaSeconds + queueWaitSeconds + prepSeconds,
      queueWaitSeconds,
      prepSeconds,
      baseEtaSeconds: store.baseEtaSeconds,
    };
  }

  /**
   * The scheduled slots a customer may pick, from `from` forward. Slots
   * already at capacity come back marked unavailable rather than omitted, so
   * the UI can grey them out and the customer understands the store is busy
   * instead of wondering where the times went.
   */
  async pickupSlots(storeId: string, from: Date = new Date(), hours = SLOT_HORIZON_HOURS): Promise<PickupSlot[]> {
    const store = await this.capacityFor(storeId);
    const start = ceilToSlot(from);
    const end = new Date(start.getTime() + hours * 60 * 60 * 1000);

    const counts = await this.slotOccupancy(storeId, start, end);

    const slots: PickupSlot[] = [];
    for (let t = start.getTime(); t < end.getTime(); t += SLOT_MS) {
      const startsAt = new Date(t);
      const taken = counts.get(t) ?? 0;
      slots.push({
        startsAt,
        endsAt: new Date(t + SLOT_MS),
        taken,
        capacity: store.slotCapacity,
        available: taken < store.slotCapacity,
      });
    }
    return slots;
  }

  /**
   * Reject a handover time whose slot is already full. Called on the order
   * path, not just the UI one — the checkout screen can be stale by seconds,
   * and two customers can pick the last slot at the same moment.
   */
  async assertSlotAvailable(storeId: string, pickupAt: Date): Promise<void> {
    const store = await this.capacityFor(storeId);
    const slotStart = floorToSlot(pickupAt);
    const taken = await this.prisma.order.count({
      where: {
        storeId,
        pickupAt: { gte: slotStart, lt: new Date(slotStart.getTime() + SLOT_MS) },
        status: { notIn: [OrderStatus.CANCELLED, OrderStatus.EXPIRED] },
      },
    });

    if (taken >= store.slotCapacity) {
      throw new BadRequestException('That pickup time has just filled up — please choose another slot');
    }
  }

  /**
   * Split a cart or order's items into the two timings the model needs:
   * what the customer waits, and what the kitchen spends.
   */
  timings(items: readonly { quantity: number; unitPrepSeconds: number }[]): {
    prepSeconds: number;
    workSeconds: number;
  } {
    let prepSeconds = 0;
    let workSeconds = 0;
    for (const item of items) {
      prepSeconds = Math.max(prepSeconds, item.unitPrepSeconds);
      workSeconds += item.unitPrepSeconds * item.quantity;
    }
    return { prepSeconds, workSeconds };
  }

  async capacityFor(storeId: string): Promise<StoreCapacity> {
    const store = await this.prisma.store.findUnique({
      where: { id: storeId },
      select: { baseEtaSeconds: true, kitchenParallelism: true, slotCapacity: true },
    });
    if (!store) throw new NotFoundException('Store not found');
    return store;
  }

  /** Orders per slot start (epoch ms) inside [from, to). */
  private async slotOccupancy(storeId: string, from: Date, to: Date): Promise<Map<number, number>> {
    const orders = await this.prisma.order.findMany({
      where: {
        storeId,
        pickupAt: { gte: from, lt: to },
        status: { notIn: [OrderStatus.CANCELLED, OrderStatus.EXPIRED] },
      },
      select: { pickupAt: true },
    });

    const counts = new Map<number, number>();
    for (const { pickupAt } of orders) {
      const key = floorToSlot(pickupAt).getTime();
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }
}

export function floorToSlot(date: Date): Date {
  return new Date(Math.floor(date.getTime() / SLOT_MS) * SLOT_MS);
}

export function ceilToSlot(date: Date): Date {
  return new Date(Math.ceil(date.getTime() / SLOT_MS) * SLOT_MS);
}
