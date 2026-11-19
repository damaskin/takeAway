import type { Prisma } from '@prisma/client';

/**
 * A stop that still holds: no expiry, or one still ahead. Shared by the
 * product stop-list (`StopListEntry`) and the catalog options' store stops
 * (`StoreOptionStop`).
 */
export function activeStopWhere(now: Date = new Date()) {
  return { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] } satisfies Prisma.StoreOptionStopWhereInput &
    Prisma.StopListEntryWhereInput;
}
