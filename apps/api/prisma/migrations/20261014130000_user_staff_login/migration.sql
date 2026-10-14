-- Staff without an email: the owner invites them by a login and hands the
-- temporary password over in person. Stored lowercase; the API keeps it to
-- [a-z0-9._-]{3,32}, so it never contains an '@' and never equals an email.
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "login" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "User_login_key" ON "User"("login");
