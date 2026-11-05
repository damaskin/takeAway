-- Who cancelled an order, why, and what the kitchen added: the customer's
-- order screen now says it, as the push already did. Until now this lived
-- only in the CANCELLED event's payload {from, by, reason?, comment?}.

-- CreateEnum
CREATE TYPE "OrderCanceller" AS ENUM ('CUSTOMER', 'STORE');

-- CreateEnum
CREATE TYPE "OrderCancelReason" AS ENUM ('OUT_OF_STOCK', 'TOO_BUSY', 'CLOSING', 'OTHER', 'CARD_DECLINED');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancelComment" TEXT,
ADD COLUMN     "cancelReason" "OrderCancelReason",
ADD COLUMN     "cancelledBy" "OrderCanceller";

-- Backfill cancelled orders from their latest CANCELLED event. Events that
-- do not say who cancelled (the oldest ones) leave the order as it was. A
-- reason outside the list is dropped. The comment is copied only from the
-- kitchen's own rejection: on a declined card the event's comment is the
-- bank's message, which the customer is not shown.
UPDATE "Order" AS o
SET
  "cancelledBy" = CASE e."payload"->>'by'
    WHEN 'customer' THEN 'CUSTOMER'::"OrderCanceller"
    ELSE 'STORE'::"OrderCanceller"
  END,
  "cancelReason" = CASE
    WHEN e."payload"->>'reason' IN ('OUT_OF_STOCK', 'TOO_BUSY', 'CLOSING', 'OTHER', 'CARD_DECLINED')
      THEN (e."payload"->>'reason')::"OrderCancelReason"
  END,
  "cancelComment" = CASE
    WHEN e."payload"->>'by' = 'store' AND COALESCE(e."payload"->>'reason', '') <> 'CARD_DECLINED'
      THEN NULLIF(BTRIM(e."payload"->>'comment'), '')
  END
FROM (
  SELECT DISTINCT ON ("orderId") "orderId", "payload"
  FROM "OrderEvent"
  WHERE "type" = 'CANCELLED'
  ORDER BY "orderId", "createdAt" DESC
) AS e
WHERE o."id" = e."orderId"
  AND o."status" = 'CANCELLED'
  AND e."payload"->>'by' IN ('customer', 'store');
