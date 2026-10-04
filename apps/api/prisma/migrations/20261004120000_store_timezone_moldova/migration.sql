-- Data fix: stores left on the UTC placeholder that trade in Moldovan lei
-- or Transnistrian roubles are in Moldova or Transnistria, whose clock is
-- Europe/Chisinau. On UTC their working hours were read two to three hours
-- off, and the Tiraspol store looked closed for hours after staff opened a
-- shift. Stores in other currencies are left alone: their zone cannot be
-- told from the currency, and the admin flags them for the owner.
UPDATE "Store"
SET "timezone" = 'Europe/Chisinau'
WHERE "timezone" IN ('UTC', 'Etc/UTC')
  AND "currency" IN ('MDL', 'RUP');
