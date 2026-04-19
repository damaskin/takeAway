-- Per-store delivery fee overrides.
-- All nullable — NULL means "inherit the DELIVERY_FEE_* env defaults".

ALTER TABLE "Store"
  ADD COLUMN "deliveryFeeBaseCents"  INTEGER,
  ADD COLUMN "deliveryFeePerKmCents" INTEGER,
  ADD COLUMN "deliveryFreeRadiusM"   INTEGER,
  ADD COLUMN "deliveryMaxRadiusM"    INTEGER;
