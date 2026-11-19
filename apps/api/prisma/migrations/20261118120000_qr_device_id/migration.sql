-- The device id Agroprombank issues a merchant for payment notifications
-- (`DeviceId` in the mobile-payment credentials header). Optional: without
-- it the header carries `-1`, as for a server client.

-- AlterTable
ALTER TABLE "PaymentTerminal" ADD COLUMN     "qrDeviceId" TEXT;
