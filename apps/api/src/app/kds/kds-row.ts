import type { Prisma } from '@prisma/client';

import { type AcceptancePolicy, kitchenTimeline } from '../kitchen/kitchen-timeline';

/**
 * One row of the kitchen board — `GET /kds/orders` and every
 * `kds.orderChanged` that carries a row, whoever sends it (the board's own
 * transitions, a new order, a payment landing), so the board can patch it
 * in place without a second read.
 */

/** What a board row needs beyond the order itself: its lines, the customer's arrival pings, the store's parallelism. */
export const BOARD_INCLUDE = {
  items: true,
  events: {
    where: { type: { in: ['CUSTOMER_NEARBY', 'CUSTOMER_HERE'] } },
    select: { type: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  },
  store: { select: { kitchenParallelism: true } },
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

export function toBoardRow(o: BoardOrder, acceptance: AcceptancePolicy) {
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
    ...kitchenTimeline(o, o.store.kitchenParallelism, acceptance),
    items: o.items.map((i) => ({
      productSnapshot: i.productSnapshot,
      quantity: i.quantity,
    })),
  };
}

export type BoardRow = ReturnType<typeof toBoardRow>;
