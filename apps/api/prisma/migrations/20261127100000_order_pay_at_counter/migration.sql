-- Orders paid at the store: the brand took no online payment when the order
-- was placed (docs/agroprombank-payments.md §13.3).
ALTER TABLE "Order" ADD COLUMN "payAtCounter" BOOLEAN NOT NULL DEFAULT false;
