-- Loyalty points are takeAway's to fund since 2026-11-14 (Maxim's list 6.0,
-- item 6; docs/settlements.md): takeAway compensates the venue for the
-- points a guest spends, like a takeAway promo. For the business such an
-- order is worth its full menu price, so revenue becomes subtotalCents −
-- (discountCents − takeawayDiscountCents − pointsDiscountCents): only the
-- business's own promo codes are its discount — the same arithmetic as
-- analytics-sql.ts / money.ts.
DROP MATERIALIZED VIEW IF EXISTS "mv_orders_daily";

CREATE MATERIALIZED VIEW "mv_orders_daily" AS
SELECT
  s."brandId"                                    AS "brandId",
  o."storeId"                                    AS "storeId",
  date_trunc('day', o."createdAt")::date         AS "day",
  COUNT(*)::bigint                               AS "orderCount",
  COALESCE(SUM(GREATEST(o."subtotalCents" - GREATEST(o."discountCents" - o."takeawayDiscountCents" - o."pointsDiscountCents", 0), 0)), 0)::bigint AS "revenueCents",
  COUNT(*) FILTER (
    WHERE o."readyAt" IS NOT NULL
      AND EXTRACT(EPOCH FROM (o."readyAt" - COALESCE(o."acceptedAt", o."createdAt"))) <= 420
  )::bigint                                      AS "slaHits",
  COUNT(*) FILTER (WHERE o."readyAt" IS NOT NULL)::bigint AS "slaTotal",
  COALESCE(
    SUM(
      CASE
        WHEN o."status" = 'PICKED_UP' AND o."readyAt" IS NOT NULL AND o."pickedUpAt" IS NOT NULL
          THEN EXTRACT(EPOCH FROM (o."pickedUpAt" - o."readyAt"))
        ELSE 0
      END
    ), 0
  )::bigint                                      AS "pickupSecSum",
  COUNT(*) FILTER (
    WHERE o."status" = 'PICKED_UP' AND o."readyAt" IS NOT NULL AND o."pickedUpAt" IS NOT NULL
  )::bigint                                      AS "pickupSecCount"
FROM "Order" o
JOIN "Store" s ON s.id = o."storeId"
WHERE o."status" NOT IN ('CANCELLED', 'EXPIRED')
GROUP BY s."brandId", o."storeId", date_trunc('day', o."createdAt")::date;

-- Required by REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX "mv_orders_daily_uniq"
  ON "mv_orders_daily" ("brandId", "storeId", "day");
CREATE INDEX "mv_orders_daily_brand_day"
  ON "mv_orders_daily" ("brandId", "day" DESC);
CREATE INDEX "mv_orders_daily_store_day"
  ON "mv_orders_daily" ("storeId", "day" DESC);
