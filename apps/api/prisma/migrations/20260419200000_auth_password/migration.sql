-- Migration: drop phone+OTP auth, add email+password auth primitives.
--
--  * Drops the OtpRequest table (and its FK to User).
--  * Adds User.passwordHash (bcrypt, nullable — only staff/admin use it).
--  * Adds a PasswordResetToken table for the email-based forgot-password flow.

-- Drop OTP table (cascade kills the FK index).
DROP TABLE IF EXISTS "OtpRequest";

-- User.passwordHash
ALTER TABLE "User" ADD COLUMN "passwordHash" TEXT;

-- PasswordResetToken
CREATE TABLE "PasswordResetToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PasswordResetToken_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PasswordResetToken_tokenHash_key" ON "PasswordResetToken"("tokenHash");
CREATE INDEX "PasswordResetToken_userId_idx" ON "PasswordResetToken"("userId");
CREATE INDEX "PasswordResetToken_expiresAt_idx" ON "PasswordResetToken"("expiresAt");

ALTER TABLE "PasswordResetToken"
    ADD CONSTRAINT "PasswordResetToken_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
