import { Prisma } from '@prisma/client';

import type { AnalyticsScope } from '../analytics/analytics-scope';
import { COUNTED, REVENUE, num, scopeConditions, utc, whereAll } from '../analytics/analytics-sql';
import { CHURN_WINDOWS, type ChurnWindow, INACTIVE_MIN_ORDERS } from '../analytics/retention';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * Customer segments — one definition behind the «Клиенты» filter, the
 * campaign audience and the promo restriction, so the three always mean the
 * same people:
 *
 * - regular («Постоянные») — at least {@link INACTIVE_MIN_ORDERS} counted
 *   orders;
 * - inactive («Неактивные») — a regular whose last counted order is more
 *   than `days` days old (3, 7 or 14, the windows of the analytics).
 *
 * Orders count as in the analytics: anything but cancelled or expired, in
 * the scope (the brand, or one of its stores). Deleted accounts are left
 * out — there is nobody to bring back.
 */
export const CUSTOMER_SEGMENTS = ['all', 'regular', 'inactive'] as const;
export type CustomerSegment = (typeof CUSTOMER_SEGMENTS)[number];

export const INACTIVE_DAYS = CHURN_WINDOWS;
export type InactiveDays = ChurnWindow;
export const DEFAULT_INACTIVE_DAYS: InactiveDays = 14;

const DAY_MS = 24 * 60 * 60_000;

/** A last order before this instant makes a regular inactive. */
export function inactiveBefore(days: number, now: Date = new Date()): Date {
  return new Date(now.getTime() - days * DAY_MS);
}

/** The segment rule on one customer's totals — the SQL below says the same. */
export function isInactive(customer: { orders: number; lastOrderAt: Date }, days: number, now = new Date()): boolean {
  return customer.orders >= INACTIVE_MIN_ORDERS && customer.lastOrderAt.getTime() < inactiveBefore(days, now).getTime();
}

/**
 * Per-customer totals over the counted orders in scope — `userId`,
 * `orders`, `totalCents`, `firstOrderAt`, `lastOrderAt` — for everyone, or
 * for one customer when `userId` is given.
 */
export function perCustomerSql(scope: AnalyticsScope, userId?: string): Prisma.Sql {
  return Prisma.sql`
    SELECT o."userId" AS "userId",
           COUNT(*)::int AS "orders",
           COALESCE(SUM(${REVENUE}), 0)::bigint AS "totalCents",
           MIN(o."createdAt") AS "firstOrderAt",
           MAX(o."createdAt") AS "lastOrderAt"
    FROM "Order" o
    JOIN "Store" s ON s.id = o."storeId"
    JOIN "User" uu ON uu.id = o."userId"
    ${whereAll([
      ...scopeConditions(scope),
      COUNTED,
      Prisma.sql`uu."blockedAt" IS NULL`,
      ...(userId ? [Prisma.sql`o."userId" = ${userId}`] : []),
    ])}
    GROUP BY o."userId"
  `;
}

/** The inactive rule as a condition on the per-customer rows aliased `p`. */
export function inactiveSql(days: number, now = new Date()): Prisma.Sql {
  return Prisma.sql`p."orders" >= ${INACTIVE_MIN_ORDERS} AND p."lastOrderAt" < ${utc(inactiveBefore(days, now))}`;
}

/** A segment as a condition on the per-customer rows aliased `p`; null means everyone. */
export function segmentSql(segment: CustomerSegment, days: number, now = new Date()): Prisma.Sql | null {
  if (segment === 'regular') return Prisma.sql`p."orders" >= ${INACTIVE_MIN_ORDERS}`;
  if (segment === 'inactive') return inactiveSql(days, now);
  return null;
}

/** Everyone in the inactive segment of a scope — the people an INACTIVE campaign goes to. */
export async function inactiveCustomerIds(
  prisma: PrismaService,
  scope: AnalyticsScope,
  days: number,
  now = new Date(),
): Promise<string[]> {
  const rows = await prisma.$queryRaw<Array<{ userId: string }>>`
    WITH per_user AS (${perCustomerSql(scope)})
    SELECT p."userId" AS "userId" FROM per_user p
    WHERE ${inactiveSql(days, now)}
  `;
  return rows.map((r) => r.userId);
}

/** Whether one customer is in the inactive segment of a scope right now. */
export async function isInactiveCustomer(
  prisma: PrismaService,
  scope: AnalyticsScope,
  userId: string,
  days: number,
  now = new Date(),
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ orders: number; lastOrderAt: Date }>>`${perCustomerSql(scope, userId)}`;
  const row = rows[0];
  return row ? isInactive({ orders: num(row.orders), lastOrderAt: row.lastOrderAt }, days, now) : false;
}
