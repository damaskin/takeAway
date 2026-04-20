-- Customer-facing push toggles. Default ON so existing users keep
-- receiving notifications until they opt out.
ALTER TABLE "User"
  ADD COLUMN "notifyOrderUpdates" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "notifyPromotions"   BOOLEAN NOT NULL DEFAULT true;
