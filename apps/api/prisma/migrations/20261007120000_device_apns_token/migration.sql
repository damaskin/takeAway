-- The iOS app registers its raw APNs device token next to the FCM token, so
-- the API can push to Apple directly instead of relying on the APNs key in
-- the Firebase project. Older app versions leave both columns null and keep
-- going through FCM.
-- CreateEnum
CREATE TYPE "ApnsEnvironment" AS ENUM ('PRODUCTION', 'SANDBOX');

-- AlterTable
ALTER TABLE "Device" ADD COLUMN     "apnsEnvironment" "ApnsEnvironment",
ADD COLUMN     "apnsToken" TEXT;

-- CreateIndex
CREATE INDEX "Device_apnsToken_idx" ON "Device"("apnsToken");
