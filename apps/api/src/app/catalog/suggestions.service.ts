import { createHash } from 'node:crypto';

import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { suggestFood } from '@takeaway/utils';

import { COUNTED, num, utc } from '../analytics/analytics-sql';
import { PrismaService } from '../prisma/prisma.service';
import { RedisService } from '../redis/redis.service';
import { CatalogService } from './catalog.service';
import {
  COPURCHASE_WINDOW_DAYS,
  type CoPurchase,
  type CoPurchaseRow,
  pickCoPurchased,
  rankCoPurchases,
} from './copurchase';
import { DEFAULT_SUGGESTIONS, type StoreSuggestionsDto } from './dto/suggestions.dto';

const CACHE_KEY = 'catalog:suggestions:v1';
/** The counts move slowly; the menu and the stop list are read fresh on every request. */
export const SUGGESTIONS_CACHE_SECONDS = 600;
/** Co-purchases remembered per set of products in hand — plenty to fill a row after the menu's filters. */
const KEEP = 50;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * What to offer next to the products a customer has in hand — the cart's
 * «Часто берут вместе» / «Добавить к напитку?», the product page's row.
 *
 * Ranked by how often customers bought them together (see `copurchase.ts`);
 * with too few orders for that, the menu rule the clients have always
 * used: bakery and food next to a drink (`suggestFood`). The counts are
 * cached for ten minutes per store and product set; the menu, with what is
 * sold out right now, is read on every request.
 */
@Injectable()
export class SuggestionsService {
  private readonly logger = new Logger(SuggestionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly catalog: CatalogService,
  ) {}

  async suggest(
    storeIdOrSlug: string,
    productIds: readonly string[],
    limit = DEFAULT_SUGGESTIONS,
  ): Promise<StoreSuggestionsDto> {
    const store = await this.prisma.store.findFirst({
      where: { OR: [{ id: storeIdOrSlug }, { slug: storeIdOrSlug }], brand: { moderationStatus: 'APPROVED' } },
      select: { id: true, brandId: true },
    });
    if (!store) throw new NotFoundException('Store not found');

    const inHand = [...new Set(productIds)].sort();
    const menu = await this.catalog.getMenu(store.id);
    if (inHand.length > 0) {
      const ranked = await this.coPurchases(store, inHand);
      const picked = ranked ? pickCoPurchased(menu, ranked, inHand, limit) : [];
      if (picked.length > 0) return { productIds: picked, source: 'copurchase' };
    }
    return { productIds: suggestFood(menu, inHand, limit).map((s) => s.product.id), source: 'rule' };
  }

  /** {@link rankCoPurchases} for this store, from Redis or counted afresh. A broken cache only costs speed. */
  private async coPurchases(
    store: { id: string; brandId: string },
    inHand: readonly string[],
  ): Promise<CoPurchase[] | null> {
    const key = `${CACHE_KEY}:${store.id}:${createHash('sha1').update(inHand.join(',')).digest('hex')}`;
    try {
      const stored = await this.redis.get(key);
      if (stored !== null) return JSON.parse(stored) as CoPurchase[] | null;
    } catch (error) {
      this.logger.warn(`Suggestions cache read failed: ${(error as Error).message}`);
    }
    const ranked = rankCoPurchases(await this.countBaskets(store, inHand))?.slice(0, KEEP) ?? null;
    try {
      await this.redis.set(key, JSON.stringify(ranked), SUGGESTIONS_CACHE_SECONDS);
    } catch (error) {
      this.logger.warn(`Suggestions cache write failed: ${(error as Error).message}`);
    }
    return ranked;
  }

  /**
   * The brand's counted orders of the last 90 days that hold a product in
   * hand (a basket), and for every other product how many baskets it was in
   * — at this store and across the brand, so one pass serves both. Items
   * are matched by the product id in their snapshot; orders from before
   * snapshots carried one are left out.
   */
  private async countBaskets(
    store: { id: string; brandId: string },
    inHand: readonly string[],
  ): Promise<CoPurchaseRow[]> {
    const since = new Date(Date.now() - COPURCHASE_WINDOW_DAYS * DAY_MS);
    const ids = [...inHand];
    const rows = await this.prisma.$queryRaw<
      Array<{ productId: string | null; here: bigint | number; brand: bigint | number }>
    >`
      WITH baskets AS (
        SELECT o.id, o."storeId" = ${store.id} AS "here"
        FROM "Order" o
        JOIN "Store" s ON s.id = o."storeId"
        WHERE s."brandId" = ${store.brandId}
          AND ${COUNTED}
          AND o."createdAt" >= ${utc(since)}
          AND EXISTS (
            SELECT 1 FROM "OrderItem" g
            WHERE g."orderId" = o.id AND g."productSnapshot"->>'id' = ANY(${ids}::text[])
          )
      ),
      pairs AS (
        SELECT DISTINCT b.id AS "orderId", b."here", oi."productSnapshot"->>'id' AS "productId"
        FROM baskets b
        JOIN "OrderItem" oi ON oi."orderId" = b.id
        WHERE oi."productSnapshot"->>'id' IS NOT NULL
          AND NOT (oi."productSnapshot"->>'id' = ANY(${ids}::text[]))
      )
      SELECT NULL::text AS "productId",
             COUNT(DISTINCT "orderId") FILTER (WHERE "here") AS "here",
             COUNT(DISTINCT "orderId") AS "brand"
      FROM pairs
      UNION ALL
      SELECT "productId", COUNT(*) FILTER (WHERE "here"), COUNT(*)
      FROM pairs
      GROUP BY "productId"
    `;
    return rows.map((row) => ({ productId: row.productId, here: num(row.here), brand: num(row.brand) }));
  }
}
