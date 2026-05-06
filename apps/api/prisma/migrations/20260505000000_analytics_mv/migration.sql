-- mv_orders_daily — per-(brand, store, day) aggregate over non-cancelled orders.
--
-- Powers /admin/analytics/{summary, revenue, stores}. Refreshed concurrently
-- every 5 minutes by AnalyticsRefreshService; the REFRESH MATERIALIZED VIEW
-- CONCURRENTLY path requires a UNIQUE index, hence the (brand_id, store_id,
-- day) index below.
--
-- "day" is the UTC calendar day of Order.createdAt — analytics is reported in
-- UTC for now. Per-store-timezone roll-ups would need a separate view.
CREATE MATERIALIZED VIEW IF NOT EXISTS "mv_orders_daily" AS
SELECT
  s."brandId"                                    AS "brandId",
  o."storeId"                                    AS "storeId",
  date_trunc('day', o."createdAt")::date         AS "day",
  COUNT(*)::bigint                               AS "orderCount",
  COALESCE(SUM(o."totalCents"), 0)::bigint       AS "revenueCents",
  -- Pickup-SLA inputs: count an order as a "hit" when it went from ACCEPTED
  -- (or CREATED if never accepted) to READY in ≤ 7 minutes. NULL readyAt
  -- means the kitchen never marked it ready, so it doesn't count either way.
  COUNT(*) FILTER (
    WHERE o."readyAt" IS NOT NULL
      AND EXTRACT(EPOCH FROM (o."readyAt" - COALESCE(o."acceptedAt", o."createdAt"))) <= 420
  )::bigint                                      AS "slaHits",
  COUNT(*) FILTER (WHERE o."readyAt" IS NOT NULL)::bigint AS "slaTotal",
  -- Pickup duration (READY → PICKED_UP) sums for avgPickupSeconds.
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
WHERE o."status" <> 'CANCELLED'
GROUP BY s."brandId", o."storeId", date_trunc('day', o."createdAt")::date;

-- Required by REFRESH MATERIALIZED VIEW CONCURRENTLY.
CREATE UNIQUE INDEX IF NOT EXISTS "mv_orders_daily_uniq"
  ON "mv_orders_daily" ("brandId", "storeId", "day");

-- Common access patterns: filter by brand + range, filter by store + range.
CREATE INDEX IF NOT EXISTS "mv_orders_daily_brand_day"
  ON "mv_orders_daily" ("brandId", "day" DESC);
CREATE INDEX IF NOT EXISTS "mv_orders_daily_store_day"
  ON "mv_orders_daily" ("storeId", "day" DESC);

-- Initial population so the first REFRESH … CONCURRENTLY succeeds.
REFRESH MATERIALIZED VIEW "mv_orders_daily";
