import type { Prisma } from '@prisma/client';

import { acceptancePolicy, kitchenTimeline } from '../kitchen/kitchen-timeline';

/**
 * One row of the kitchen board — `GET /kds/orders` and every
 * `kds.orderChanged` that carries a row, whoever sends it (the board's own
 * transitions, a new order, a payment landing), so the board can patch it
 * in place without a second read.
 */

/**
 * What a board row needs beyond the order itself: its lines, the customer's
 * arrival pings, the store's parallelism and accept time.
 */
export const BOARD_INCLUDE = {
  items: true,
  events: {
    where: { type: { in: ['CUSTOMER_NEARBY', 'CUSTOMER_HERE'] } },
    select: { type: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
  store: { select: { kitchenParallelism: true, baseEtaSeconds: true } },
} satisfies Prisma.OrderInclude;

export type BoardOrder = Prisma.OrderGetPayload<{ include: typeof BOARD_INCLUDE }>;

/**
 * Where the customer is, from the pings their app sends: HERE once they
 * tapped "I'm here" (or walked into the store), NEARBY when they are close.
 * The latest-reached level wins, so HERE is never downgraded.
 */
export function customerArrival(events: readonly { type: string; createdAt: Date }[]): {
  customerArrival: 'NEARBY' | 'HERE' | null;
  customerArrivedAt: string | null;
} {
  const here = events.find((e) => e.type === 'CUSTOMER_HERE');
  if (here) return { customerArrival: 'HERE', customerArrivedAt: here.createdAt.toISOString() };
  const nearby = events.find((e) => e.type === 'CUSTOMER_NEARBY');
  if (nearby) return { customerArrival: 'NEARBY', customerArrivedAt: nearby.createdAt.toISOString() };
  return { customerArrival: null, customerArrivedAt: null };
}

/** O and G of the order in its store's queue (QueuePolicyService.plans), epoch ms. */
export interface BoardPlan {
  startAt: number;
  readyAt: number;
}

/**
 * The row, its acceptance times by its store's accept time. Under the queue
 * policy the caller passes the order's plan: `startBy` is then when the
 * queue has the kitchen take it (O), and `plannedReadyAt` when it will be
 * ready (G, «готов к 12:11»).
 */
export function toBoardRow(o: BoardOrder, plan?: BoardPlan | null) {
  return {
    id: o.id,
    orderCode: o.orderCode,
    status: o.status,
    pickupMode: o.pickupMode,
    pickupAt: o.pickupAt.toISOString(),
    createdAt: o.createdAt.toISOString(),
    customerName: o.customerName,
    notes: o.notes,
    ...customerArrival(o.events),
    ...kitchenTimeline(o, o.store.kitchenParallelism, acceptancePolicy(o.store)),
    ...(plan
      ? { startBy: new Date(plan.startAt).toISOString(), plannedReadyAt: new Date(plan.readyAt).toISOString() }
      : {}),
    items: o.items.map((i) => ({
      productSnapshot: i.productSnapshot,
      quantity: i.quantity,
    })),
  };
}

export type BoardRow = ReturnType<typeof toBoardRow>;
