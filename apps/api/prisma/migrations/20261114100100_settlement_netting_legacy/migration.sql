-- A payout transferred before the netted settlements was final: nobody was
-- asked to confirm it. It reads as confirmed now, so it keeps closing the
-- balance it closed. (Production had none at the change; staging neither.)
UPDATE "BrandPayout"
SET "status" = 'CONFIRMED', "confirmedAt" = "paidAt"
WHERE "status" = 'PAID';
