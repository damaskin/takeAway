import { Prisma } from '@prisma/client';

import type { AnalyticsScope } from './analytics-scope';

/**
 * SQL pieces every analytics query over `"Order" o JOIN "Store" s` shares.
 *
 * Revenue, orders and customers count an order unless it was cancelled or
 * expired — an expired order was never accepted, so nobody was charged.
 */
export const COUNTED = Prisma.sql`o."status" NOT IN ('CANCELLED', 'EXPIRED')`;

/** Orders handed over at the counter with both timestamps: the pickup time sample. */
export const PICKUP_DONE = Prisma.sql`o."status" = 'PICKED_UP' AND o."readyAt" IS NOT NULL AND o."pickedUpAt" IS NOT NULL`;

/** The scope as conditions on `s."brandId"` and the given store column. */
export function scopeConditions(
  scope: AnalyticsScope,
  storeColumn: Prisma.Sql = Prisma.raw('o."storeId"'),
): Prisma.Sql[] {
  const conditions: Prisma.Sql[] = [];
  if (scope.brandIds) conditions.push(Prisma.sql`s."brandId" = ANY(${[...scope.brandIds]}::text[])`);
  if (scope.storeIds) conditions.push(Prisma.sql`${storeColumn} = ANY(${[...scope.storeIds]}::text[])`);
  return conditions;
}

export function whereAll(conditions: readonly Prisma.Sql[]): Prisma.Sql {
  return conditions.length ? Prisma.sql`WHERE ${Prisma.join([...conditions], ' AND ')}` : Prisma.empty;
}

/**
 * An instant as a `timestamp`. The columns hold UTC wall time without a
 * zone; a bound `Date` arrives as `timestamptz`, and comparing the two
 * converts through the session's TimeZone, which is not always UTC. An ISO
 * string cast to `timestamp` drops its `Z` and lines up with the columns
 * whatever the session says.
 */
export function utc(instant: Date): Prisma.Sql {
  return Prisma.sql`${instant.toISOString()}::timestamp`;
}

/** `createdAt` inside [start, end). */
export function createdBetween(start: Date, end: Date): Prisma.Sql[] {
  return [Prisma.sql`o."createdAt" >= ${utc(start)}`, Prisma.sql`o."createdAt" < ${utc(end)}`];
}

/** The scope as a filter on `Store` rows. */
export function storeWhere(scope: AnalyticsScope): Prisma.StoreWhereInput {
  return {
    ...(scope.brandIds ? { brandId: { in: [...scope.brandIds] } } : {}),
    ...(scope.storeIds ? { id: { in: [...scope.storeIds] } } : {}),
  };
}

/** The scope as a filter on live `Order` rows. */
export function orderWhere(scope: AnalyticsScope): Prisma.OrderWhereInput {
  const where: Prisma.OrderWhereInput = {};
  if (scope.storeIds) where.storeId = { in: [...scope.storeIds] };
  if (scope.brandIds) where.store = { brandId: { in: [...scope.brandIds] } };
  return where;
}

/** Bigints and numeric strings from `$queryRaw` as plain numbers. */
export function num(value: bigint | number | string | null | undefined): number {
  if (value === null || value === undefined) return 0;
  return typeof value === 'number' ? value : Number(value);
}
