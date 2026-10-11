-- A Google or Apple sign-in used to join any existing customer profile whose
-- email matched — including an address someone had merely typed into their
-- own profile, unverified. Now only a verified address joins, and this
-- column records which ones are.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "emailVerifiedAt" TIMESTAMP(3);

-- Backfill: a customer profile that was created by a Google or Apple sign-in
-- took its email from that provider (the OAuth account is written in the
-- same statement as the user). Addresses typed into a profile, or attached
-- later, stay unverified until the next sign-in with a provider that vouches
-- for the same address.
UPDATE "User" u
SET "emailVerifiedAt" = u."createdAt"
WHERE u."email" IS NOT NULL
  AND u."role" = 'CUSTOMER'
  AND EXISTS (
    SELECT 1
    FROM "OAuthAccount" o
    WHERE o."userId" = u."id"
      AND o."provider" IN ('GOOGLE', 'APPLE')
      AND o."createdAt" <= u."createdAt" + INTERVAL '1 minute'
  );
