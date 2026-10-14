-- Kitchen operations policy (2026-10-14, docs/kitchen-policy.md).
--
-- StoreShift: the kitchen can take ASAP orders past the working hours until
-- `extendedUntil`; a shift the schedule closed by itself is marked.
--
-- Order: `kitchenVisibleAt` starts the acceptance clock (the order reached
-- the kitchen board); the four `*SentAt` / `*NotifiedAt` columns make each
-- reminder go out once, whichever API instance's cron gets there first.
-- No backfill: orders from before this migration keep the old expiry rules.

-- AlterTable
ALTER TABLE "StoreShift" ADD COLUMN     "closedAutomatically" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "extendedUntil" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "acceptAlertSentAt" TIMESTAMP(3),
ADD COLUMN     "kitchenVisibleAt" TIMESTAMP(3),
ADD COLUMN     "lateAlertSentAt" TIMESTAMP(3),
ADD COLUMN     "lateNotifiedAt" TIMESTAMP(3),
ADD COLUMN     "startReminderSentAt" TIMESTAMP(3);
