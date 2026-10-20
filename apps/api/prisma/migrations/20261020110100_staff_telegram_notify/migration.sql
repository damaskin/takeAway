-- Telegram for work notifications gets a column of its own, linked through
-- the bot (docs/staff-access.md). telegramUserId stays the customer's
-- sign-in identity.

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "telegramNotifyChatId" BIGINT;

-- Staff, owners and admins who linked Telegram on the old «Telegram» page
-- had it written to telegramUserId. Their notifications now go to
-- telegramNotifyChatId, so they keep coming without linking again.
-- telegramUserId is left as it is: the next Telegram sign-in with it opens a
-- customer profile and moves it off the staff account.
UPDATE "User"
SET "telegramNotifyChatId" = "telegramUserId"
WHERE "telegramUserId" IS NOT NULL
  AND "role" <> 'CUSTOMER';
