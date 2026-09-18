-- Sales tax per store. Order.taxCents was hard-coded to 0, which made every
-- receipt legally wrong in a VAT market and overstated revenue in analytics
-- by the tax we were not separating out.
--
-- Rate is basis points so 5% (UAE) and 20% (UK) are both exact integers.
-- taxIncludedInPrice defaults to true because that matches every launch
-- market in the brief; it is false only where tax is added at the till.
ALTER TABLE "Store"
  ADD COLUMN "taxRateBps" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "taxIncludedInPrice" BOOLEAN NOT NULL DEFAULT true;
