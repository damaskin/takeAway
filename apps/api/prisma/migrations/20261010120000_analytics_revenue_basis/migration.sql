-- Revenue is sales less discounts, the way every analytics screen now counts
-- it: subtotalCents − discountCents (promo codes and loyalty points). The view
-- summed totalCents — the card charge — which leaves out whatever a gift card
-- paid for, so a brand's revenue here was lower than on its own dashboard.
DROP MATERIALIZED VIEW IF EXISTS "mv_orders_daily";

CREATE MATERIALIZED VIEW "mv_orders_daily" AS
SELECT
  s."brandId"                                    AS "brandId",
  o."storeId"                                    AS "storeId",
  date_trunc('day', o."createdAt")::date         AS "day",
  COUNT(*)::bigint                               AS "orderCount",
  COALESCE(SUM(GREATEST(o."subtotalCents" - o."discountCents", 0)), 0)::bigint AS "revenueCents",
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
