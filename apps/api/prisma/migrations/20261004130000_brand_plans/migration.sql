-- Business plans: BASIC (10 %) and PRO (15 %).
CREATE TYPE "BrandPlan" AS ENUM ('BASIC', 'PRO');

ALTER TABLE "Brand" ADD COLUMN     "commissionBps" INTEGER NOT NULL DEFAULT 1000,
ADD COLUMN     "plan" "BrandPlan" NOT NULL DEFAULT 'BASIC';

-- Brands that exist today keep every feature they already use: they move to
-- PRO with its commission. Only brands created from here on start on BASIC.
UPDATE "Brand" SET "plan" = 'PRO', "commissionBps" = 1500;

-- Analytics ranges read one store's orders between two instants.
CREATE INDEX "Order_storeId_createdAt_idx" ON "Order"("storeId", "createdAt");

-- mv_orders_daily counted EXPIRED orders (never accepted, never charged) as
-- revenue. Rebuilt without them, so the platform view agrees with the brand
-- dashboards, which now read the Order table for their date ranges.
DROP MATERIALIZED VIEW IF EXISTS "mv_orders_daily";

CREATE MATERIALIZED VIEW "mv_orders_daily" AS
SELECT
  s."brandId"                                    AS "brandId",
  o."storeId"                                    AS "storeId",
  date_trunc('day', o."createdAt")::date         AS "day",
  COUNT(*)::bigint                               AS "orderCount",
  COALESCE(SUM(o."totalCents"), 0)::bigint       AS "revenueCents",
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
