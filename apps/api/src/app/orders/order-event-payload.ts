import type { OrderEventType, Prisma } from '@prisma/client';

/**
 * Events written from the customer's location pings. Their payload carries
 * the distance to the store — what the kitchen and the admin timeline show —
 * and, as sent, the customer's coordinates.
 */
export const CUSTOMER_ARRIVAL_EVENTS: readonly OrderEventType[] = ['CUSTOMER_NEARBY', 'CUSTOMER_HERE'];

const COORDINATE_KEYS: ReadonlySet<string> = new Set(['lat', 'lng', 'latitude', 'longitude']);

/**
 * The payload without the customer's coordinates; everything else, the
 * distance included, stays. Returns the value itself when there is nothing
 * to remove, so a caller can tell whether a write is needed.
 */
export function withoutCoordinates(payload: Prisma.JsonValue): Prisma.JsonValue {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return payload;
  if (!Object.keys(payload).some((key) => COORDINATE_KEYS.has(key))) return payload;
  return Object.fromEntries(Object.entries(payload).filter(([key]) => !COORDINATE_KEYS.has(key)));
}
