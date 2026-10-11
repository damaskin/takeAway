-- The site's «Поддержка» page takes messages from visitors without an
-- account: they leave a name (optional) and an email or phone to answer on.
-- The contact already has a column; the name gets one.
-- AlterTable
ALTER TABLE "Feedback" ADD COLUMN     "name" TEXT;
