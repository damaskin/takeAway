-- Spending loyalty points at checkout. The ledger could already debit, but
-- no customer-facing path reached it: /loyalty/me was the only endpoint and
-- the programme could accumulate forever without ever paying out.
--
-- Stored apart from discountCents so the receipt can name the currency the
-- customer actually spent ("250 points") instead of only showing a smaller
-- total.
ALTER TABLE "Order"
  ADD COLUMN "pointsSpent" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "pointsDiscountCents" INTEGER NOT NULL DEFAULT 0;
