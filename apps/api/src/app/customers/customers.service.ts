import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import type { AnalyticsScope } from '../analytics/analytics-scope';
import { COUNTED, REVENUE, num, orderWhere, scopeConditions, whereAll } from '../analytics/analytics-sql';
import { customerLabels } from '../analytics/customer-labels';
import { orderMoney } from '../analytics/money';
import { PrismaService } from '../prisma/prisma.service';
import { DEFAULT_INACTIVE_DAYS, perCustomerSql, segmentSql } from './customer-segment';
import {
  CustomerDetailDto,
  CustomerPageDto,
  CustomerSort,
  CustomerSummaryDto,
  CustomersQueryDto,
  FavouriteProductDto,
} from './dto/customers.dto';
import { productKind } from './product-kind';

const DAY_MS = 24 * 60 * 60_000;
const RECENT_ORDERS = 100;

/** Units of one product a customer has to order before it counts as their favourite. */
export const FAVOURITE_MIN_QUANTITY = 5;

interface CustomerRow {
  userId: string;
  orders: number;
  totalCents: bigint;
  firstOrderAt: Date;
  lastOrderAt: Date;
  total?: number;
}

interface FavouriteRow {
  userId: string;
  name: string | null;
  quantity: number;
  categoryName: string | null;
  caffeineLevel: number | null;
  drinkOptions: boolean;
}

/** Sort keys mapped to SQL over the `per_user` rows. A fixed list: never interpolate the query string. */
const SORT_SQL: Record<CustomerSort, Prisma.Sql> = {
  lastOrderAt: Prisma.raw('p."lastOrderAt"'),
  firstOrderAt: Prisma.raw('p."firstOrderAt"'),
  orders: Prisma.raw('p."orders"'),
  totalCents: Prisma.raw('p."totalCents"'),
  avgCheckCents: Prisma.raw('(p."totalCents"::float8 / p."orders")'),
  // Fewer days between orders is the more frequent customer; one-order
  // customers have no frequency and go last either way.
  frequency: Prisma.raw(
    'CASE WHEN p."orders" > 1 THEN EXTRACT(EPOCH FROM (p."lastOrderAt" - p."firstOrderAt")) / (p."orders" - 1) END',
  ),
};

/**
 * The business's customers: everyone with a counted order in its stores,
 * with what they spent, how often they come and what they keep ordering.
 * Deleted accounts are left out — their orders stay in the revenue, but
 * there is no person to show.
 */
@Injectable()
export class CustomersService {
  constructor(private readonly prisma: PrismaService) {}

  async list(scope: AnalyticsScope, query: CustomersQueryDto, now = new Date()): Promise<CustomerPageDto> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const sort = SORT_SQL[query.sort ?? 'lastOrderAt'];
    // Frequency reads best ascending: most frequent first.
    const dir = Prisma.raw((query.dir ?? (query.sort === 'frequency' ? 'asc' : 'desc')) === 'asc' ? 'ASC' : 'DESC');
    const search = query.search?.trim();
    const pattern = search ? `%${search.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const conditions: Prisma.Sql[] = [];
    if (pattern) {
      conditions.push(Prisma.sql`(
        u."name" ILIKE ${pattern} OR u."phone" ILIKE ${pattern} OR u."email" ILIKE ${pattern}
        OR EXISTS (
          SELECT 1 FROM "Order" o2
          WHERE o2."userId" = p."userId" AND (o2."customerName" ILIKE ${pattern} OR o2."customerPhone" ILIKE ${pattern})
        )
      )`);
    }
    const segment = segmentSql(query.segment ?? 'all', query.inactiveDays ?? DEFAULT_INACTIVE_DAYS, now);
    if (segment) conditions.push(segment);

    const rows = await this.prisma.$queryRaw<CustomerRow[]>`
      WITH per_user AS (${perCustomerSql(scope)})
      SELECT p.*, COUNT(*) OVER ()::int AS "total"
      FROM per_user p
      JOIN "User" u ON u.id = p."userId"
      ${whereAll(conditions)}
      ORDER BY ${sort} ${dir} NULLS LAST, p."userId"
      LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}
    `;

    return {
      items: await this.summaries(scope, rows, now),
      total: num(rows[0]?.total),
      page,
      pageSize,
    };
  }

  async detail(scope: AnalyticsScope, userId: string, now = new Date()): Promise<CustomerDetailDto> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, email: true, blockedAt: true },
    });
    // A deleted account, or somebody who never ordered here: nothing to show
    // and nothing to confirm about them either.
    if (!user || user.blockedAt) throw new NotFoundException('Customer not found');

    const [rows, stores, recent, cancelled, favourites] = await Promise.all([
      this.prisma.$queryRaw<CustomerRow[]>`${perCustomerSql(scope, userId)}`,
      this.prisma.$queryRaw<Array<{ storeId: string; storeName: string; orders: number; totalCents: bigint }>>`
        SELECT o."storeId" AS "storeId", s."name" AS "storeName",
               COUNT(*)::int AS "orders", COALESCE(SUM(${REVENUE}), 0)::bigint AS "totalCents"
        FROM "Order" o
        JOIN "Store" s ON s.id = o."storeId"
        ${whereAll([...scopeConditions(scope), COUNTED, Prisma.sql`o."userId" = ${userId}`])}
        GROUP BY 1, 2
        ORDER BY 3 DESC, 4 DESC
      `,
      this.prisma.order.findMany({
        where: { ...orderWhere(scope), userId },
        orderBy: { createdAt: 'desc' },
        take: RECENT_ORDERS,
        select: {
          id: true,
          orderCode: true,
          createdAt: true,
          status: true,
          subtotalCents: true,
          discountCents: true,
          giftCardCents: true,
          currency: true,
          store: { select: { name: true } },
          _count: { select: { items: true } },
        },
      }),
      this.prisma.order.count({
        where: { ...orderWhere(scope), userId, status: { in: ['CANCELLED', 'EXPIRED'] } },
      }),
      this.favourites(scope, [userId]),
    ]);
    const row = rows[0];
    if (!row) throw new NotFoundException('Customer not found');
    const [summary] = await this.summaries(scope, [row], now, favourites);
    if (!summary) throw new NotFoundException('Customer not found');

    return {
      ...summary,
      email: user.email,
      cancelledOrders: cancelled,
      stores: stores.map((s) => ({
        storeId: s.storeId,
        storeName: s.storeName,
        orders: num(s.orders),
        totalCents: num(s.totalCents),
      })),
      favourites: favourites.get(userId) ?? [],
      recentOrders: recent.map((o) => ({
        id: o.id,
        orderCode: o.orderCode,
        createdAt: o.createdAt.toISOString(),
        status: o.status,
        // The order's revenue, so the history adds up to the spend above.
        totalCents: orderMoney(o).revenueCents,
        currency: o.currency,
        storeName: o.store.name,
        itemCount: o._count.items,
      })),
    };
  }

  private async summaries(
    scope: AnalyticsScope,
    rows: CustomerRow[],
    now: Date,
    knownFavourites?: Map<string, FavouriteProductDto[]>,
  ): Promise<CustomerSummaryDto[]> {
    if (rows.length === 0) return [];
    const userIds = rows.map((r) => r.userId);
    const [labels, favourites, products] = await Promise.all([
      customerLabels(this.prisma, scope, userIds),
      this.prisma.$queryRaw<Array<{ userId: string; storeId: string; storeName: string }>>`
        SELECT DISTINCT ON (o."userId") o."userId" AS "userId", o."storeId" AS "storeId", s."name" AS "storeName"
        FROM "Order" o
        JOIN "Store" s ON s.id = o."storeId"
        ${whereAll([...scopeConditions(scope), COUNTED, Prisma.sql`o."userId" = ANY(${userIds}::text[])`])}
        GROUP BY o."userId", o."storeId", s."name"
        ORDER BY o."userId", COUNT(*) DESC, MAX(o."createdAt") DESC
      `,
      knownFavourites ?? this.favourites(scope, userIds),
    ]);
    const favourite = new Map(favourites.map((f) => [f.userId, f]));
    return rows.map((r) => {
      const orders = num(r.orders);
      const total = num(r.totalCents);
      const span = r.lastOrderAt.getTime() - r.firstOrderAt.getTime();
      return {
        userId: r.userId,
        name: labels.get(r.userId)?.name ?? null,
        phone: labels.get(r.userId)?.phone ?? null,
        orders,
        totalCents: total,
        avgCheckCents: orders > 0 ? Math.round(total / orders) : 0,
        firstOrderAt: r.firstOrderAt.toISOString(),
        lastOrderAt: r.lastOrderAt.toISOString(),
        avgDaysBetweenOrders: orders > 1 ? Math.round((span / DAY_MS / (orders - 1)) * 10) / 10 : null,
        daysSinceLastOrder: Math.max(0, Math.floor((now.getTime() - r.lastOrderAt.getTime()) / DAY_MS)),
        favouriteStoreId: favourite.get(r.userId)?.storeId ?? null,
        favouriteStoreName: favourite.get(r.userId)?.storeName ?? null,
        favouriteProduct: products.get(r.userId)?.[0] ?? null,
      };
    });
  }

  /**
   * The products each customer ordered at least {@link FAVOURITE_MIN_QUANTITY}
   * units of, most ordered first. A product is the one in the order snapshot
   * (by id, by name for snapshots without one), so a renamed product keeps
   * its count; it is named as it was last sold, and judged drink or food by
   * what the menu says about it now.
   */
  private async favourites(scope: AnalyticsScope, userIds: string[]): Promise<Map<string, FavouriteProductDto[]>> {
    const out = new Map<string, FavouriteProductDto[]>();
    if (userIds.length === 0) return out;
    const rows = await this.prisma.$queryRaw<FavouriteRow[]>`
      SELECT f."userId" AS "userId", f."name" AS "name", f."quantity" AS "quantity",
             c."name" AS "categoryName", pr."caffeineLevel" AS "caffeineLevel",
             EXISTS (
               SELECT 1 FROM "Variation" v
               WHERE v."productId" = pr.id AND v."type" IN ('TEMPERATURE', 'MILK', 'CUP')
             ) AS "drinkOptions"
      FROM (
        SELECT o."userId" AS "userId",
               COALESCE(oi."productSnapshot"->>'id', oi."productSnapshot"->>'name') AS "productKey",
               (ARRAY_AGG(oi."productSnapshot"->>'name' ORDER BY o."createdAt" DESC))[1] AS "name",
               SUM(oi."quantity")::int AS "quantity"
        FROM "OrderItem" oi
        JOIN "Order" o ON o.id = oi."orderId"
        JOIN "Store" s ON s.id = o."storeId"
        ${whereAll([...scopeConditions(scope), COUNTED, Prisma.sql`o."userId" = ANY(${userIds}::text[])`])}
        GROUP BY 1, 2
        HAVING SUM(oi."quantity") >= ${FAVOURITE_MIN_QUANTITY}
      ) f
      LEFT JOIN "Product" pr ON pr.id = f."productKey"
      LEFT JOIN "Category" c ON c.id = pr."categoryId"
      ORDER BY f."userId", f."quantity" DESC, f."name"
    `;
    for (const r of rows) {
      const name = r.name ?? '';
      const list = out.get(r.userId) ?? [];
      list.push({
        name,
        quantity: num(r.quantity),
        kind: productKind({
          name,
          categoryName: r.categoryName,
          caffeineLevel: r.caffeineLevel,
          drinkOptions: Boolean(r.drinkOptions),
        }),
      });
      out.set(r.userId, list);
    }
    return out;
  }
}
