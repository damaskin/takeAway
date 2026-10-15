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
 * `orders`, `totalCents`, `moneyOrders`, `firstOrderAt`, `lastOrderAt` —
 * for everyone, or for one customer when `userId` is given.
 *
 * The people and their order counts never depend on a currency. Spend does:
 * with `currency`, `totalCents` adds up only the orders in it and
 * `moneyOrders` counts them (the average check divides the two); without
 * it, every order counts for both.
 */
export function perCustomerSql(scope: AnalyticsScope, userId?: string, currency?: string | null): Prisma.Sql {
  const inCurrency = currency ? Prisma.sql`o."currency" = ${currency}::"Currency"` : Prisma.sql`TRUE`;
  return Prisma.sql`
    SELECT o."userId" AS "userId",
           COUNT(*)::int AS "orders",
           COALESCE(SUM(${REVENUE}) FILTER (WHERE ${inCurrency}), 0)::bigint AS "totalCents",
           (COUNT(*) FILTER (WHERE ${inCurrency}))::int AS "moneyOrders",
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

/** Customers of one store among those {@link inactiveAtOneStoreOnly} counts. */
export interface StoreLapsedCount {
  storeId: string;
  storeName: string;
  count: number;
}

/** Regulars who went quiet at a store but keep ordering at another. */
export interface LapsedAtOneStore {
  /** People, each once however many stores they left. */
  count: number;
  /** Per store, most first. */
  stores: StoreLapsedCount[];
}

/**
 * When a regular went quiet: their last order at the store lies before
 * `lastOrderBefore` (and, for a churn period, on or after `lastOrderFrom`),
 * counting the orders placed before `asOf` (all of them when absent).
 */
export interface LapseBounds {
  lastOrderBefore: Date;
  lastOrderFrom?: Date;
  asOf?: Date;
}

/**
 * The regulars the brand-wide inactive rule does not show: inactive at one
 * of the scope's stores — 3+ orders there, the last one before
 * `lastOrderBefore` — yet not across the scope, because they still order
 * at another store (their last order anywhere is on or after it). «Все
 * точки» counts a customer once, over every store, so these people show up
 * only when a store is picked; this says how many there are and where.
 */
export async function inactiveAtOneStoreOnly(
  prisma: PrismaService,
  scope: AnalyticsScope,
  bounds: LapseBounds,
): Promise<LapsedAtOneStore> {
  const rows = await prisma.$queryRaw<Array<{ userId: string; storeId: string; storeName: string }>>`
    WITH per_store AS (
      SELECT o."userId" AS "userId", o."storeId" AS "storeId",
             COUNT(*)::int AS "orders", MAX(o."createdAt") AS "lastOrderAt"
      FROM "Order" o
      JOIN "Store" s ON s.id = o."storeId"
      JOIN "User" uu ON uu.id = o."userId"
      ${whereAll([
        ...scopeConditions(scope),
        COUNTED,
        Prisma.sql`uu."blockedAt" IS NULL`,
        ...(bounds.asOf ? [Prisma.sql`o."createdAt" < ${utc(bounds.asOf)}`] : []),
      ])}
      GROUP BY 1, 2
    ),
    per_user AS (
      SELECT ps."userId" AS "userId", MAX(ps."lastOrderAt") AS "lastOrderAt" FROM per_store ps GROUP BY 1
    )
    SELECT ps."userId" AS "userId", ps."storeId" AS "storeId", st."name" AS "storeName"
    FROM per_store ps
    JOIN per_user pu ON pu."userId" = ps."userId"
    JOIN "Store" st ON st.id = ps."storeId"
    ${whereAll([
      Prisma.sql`ps."orders" >= ${INACTIVE_MIN_ORDERS}`,
      Prisma.sql`ps."lastOrderAt" < ${utc(bounds.lastOrderBefore)}`,
      ...(bounds.lastOrderFrom ? [Prisma.sql`ps."lastOrderAt" >= ${utc(bounds.lastOrderFrom)}`] : []),
      Prisma.sql`pu."lastOrderAt" >= ${utc(bounds.lastOrderBefore)}`,
    ])}
  `;
  const people = new Set<string>();
  const byStore = new Map<string, StoreLapsedCount>();
  for (const row of rows) {
    people.add(row.userId);
    const store = byStore.get(row.storeId) ?? { storeId: row.storeId, storeName: row.storeName, count: 0 };
    store.count += 1;
    byStore.set(row.storeId, store);
  }
  return {
    count: people.size,
    stores: [...byStore.values()].sort((a, b) => b.count - a.count || a.storeName.localeCompare(b.storeName)),
  };
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
