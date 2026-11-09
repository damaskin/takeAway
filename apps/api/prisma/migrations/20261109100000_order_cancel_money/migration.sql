-- Where the money of a cancelled or expired order went, recorded when the
-- API calls the order off — the same outcome the push states. Until now the
-- customer's order screen guessed it from the payment as it is now, and a
-- released card hold reads there just like a refund: the push said «Деньги
-- не списаны, блокировка на карте снята», the screen «Деньги вернутся на карту».

-- CreateEnum
CREATE TYPE "OrderCancelMoney" AS ENUM ('NOT_CHARGED', 'RELEASED', 'REFUNDED', 'PENDING');

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "cancelMoney" "OrderCancelMoney";

-- Backfill cancelled and expired orders from what their records still tell,
-- in the order the API decides it:
-- - a card declined on accept never took anything;
-- - a captured charge given back (a refund or a reversal, or an order the
--   acceptance SLA refunded before expiring it) is REFUNDED;
-- - a hold that came off is RELEASED;
-- - a charge put off until the accept and called off is NOT_CHARGED;
-- - a hold still on the card is PENDING (the cron keeps releasing it).
-- Anything else stays null and the clients read the payment as before:
-- no card money, a CancelOperation that may have been a hold or a charge, a
-- captured charge the store's refund failed on.
UPDATE "Order" AS o
SET "cancelMoney" = CASE
  WHEN o."cancelReason" = 'CARD_DECLINED' THEN 'NOT_CHARGED'::"OrderCancelMoney"
  WHEN EXISTS (
    SELECT 1 FROM "OrderEvent" e
    WHERE e."orderId" = o."id"
      AND e."type" = 'REFUND_ISSUED'
      AND COALESCE(e."payload"->>'kind', 'refund') IN ('refund', 'reversal')
  ) OR EXISTS (
    SELECT 1 FROM "OrderEvent" e
    WHERE e."orderId" = o."id"
      AND e."type" = 'STATUS_CHANGED'
      AND e."payload"->>'to' = 'EXPIRED'
      AND e."payload"->>'refunded' = 'true'
  ) THEN 'REFUNDED'::"OrderCancelMoney"
  WHEN EXISTS (
    SELECT 1 FROM "OrderEvent" e
    WHERE e."orderId" = o."id"
      AND e."type" = 'REFUND_ISSUED'
      AND e."payload"->>'kind' = 'hold-released'
  ) THEN 'RELEASED'::"OrderCancelMoney"
  WHEN EXISTS (
    SELECT 1 FROM "Payment" p
    WHERE p."orderId" = o."id"
      AND p."provider" IN ('AGROPROMBANK', 'AGROPROMBANK_WEB')
      AND p."status" = 'FAILED'
      AND p."rawJson"->>'voided' = 'true'
  ) THEN 'NOT_CHARGED'::"OrderCancelMoney"
  WHEN EXISTS (
    SELECT 1 FROM "Payment" p
    WHERE p."orderId" = o."id"
      AND p."provider" IN ('AGROPROMBANK', 'AGROPROMBANK_WEB')
      AND p."status" = 'REQUIRES_ACTION'
  ) THEN 'PENDING'::"OrderCancelMoney"
END
WHERE o."status" IN ('CANCELLED', 'EXPIRED');
