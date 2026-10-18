-- Makes a fresh copy of production's database safe to run as staging.
-- Applied by deploy/scripts/staging-refresh.sh right after the restore, before
-- the staging API starts again. docs/environments.md.
--
-- The copy keeps people, stores, menus and orders so a tester sees what the
-- product really looks like. What it must lose is every way of reaching a
-- real person or a real outside system from those rows: push targets, bank
-- card tokens, POS credentials, messages waiting to go out. Staging's own
-- environment already differs (its own Telegram bot, no live bank merchant,
-- its own POS key) — this is the second wall, in the data.
--
--   psql -v ON_ERROR_STOP=1 -v old_cdn=https://cdn.takeaway.md/ -v new_cdn=https://test-cdn.takeaway.md/ -f staging-sanitize.sql

\set ON_ERROR_STOP on

BEGIN;

-- Phones and browsers of real customers and staff: FCM and APNs tokens, web
-- push subscriptions (type WEB). Staging must never push to any of them.
DELETE FROM "Device";

-- Tokens the bank issued for real cards, and bindings in flight. Payments
-- keep their rows (their cardTokenId is SET NULL by the foreign key).
DELETE FROM "CardBindingRequest";
DELETE FROM "CardToken";

-- Poster: the credentials are sealed with production's POS_CREDENTIALS_KEY,
-- which staging does not have. Clear them so no sync ever tries, and drop the
-- jobs that were still queued.
UPDATE "PosIntegration"
   SET status = 'DISCONNECTED',
       "credentialsCiphertext" = '',
       "lastErrorMessage" = 'Disconnected on staging: the credentials were production''s. Reconnect a test account here.';
DELETE FROM "PosSyncJob" WHERE status IN ('PENDING', 'RUNNING');

-- Links in staff mailboxes point at production's cabinet.
DELETE FROM "PasswordResetToken";

-- Pushes and messages not yet sent stay unsent.
UPDATE "Campaign"
   SET status = 'FAILED', "lastError" = 'Not sent: staging copy of production.'
 WHERE status IN ('PENDING_REVIEW', 'APPROVED', 'SENDING');
UPDATE "Announcement"
   SET status = 'FAILED', "lastError" = 'Not sent: staging copy of production.'
 WHERE status IN ('SCHEDULED', 'SENDING');

-- Uploaded pictures (logos, product and store photos) were copied into
-- staging's own MinIO; point the rows at staging's CDN. Every text, text[]
-- and jsonb column, so a new column holding a picture URL is covered too.
-- (psql does not expand :variables inside $$, hence the settings.)
SET LOCAL takeaway.old_cdn = :'old_cdn';
SET LOCAL takeaway.new_cdn = :'new_cdn';
DO $$
DECLARE
  old_prefix text := current_setting('takeaway.old_cdn');
  new_prefix text := current_setting('takeaway.new_cdn');
  col record;
  n bigint;
  total bigint := 0;
BEGIN
  IF old_prefix = '' OR new_prefix = '' OR old_prefix = new_prefix THEN
    RAISE EXCEPTION 'old_cdn and new_cdn must be set and differ (got % -> %)', old_prefix, new_prefix;
  END IF;
  FOR col IN
    SELECT c.table_name, c.column_name, c.data_type, c.udt_name
      FROM information_schema.columns c
      JOIN information_schema.tables t
        ON t.table_schema = c.table_schema AND t.table_name = c.table_name AND t.table_type = 'BASE TABLE'
     WHERE c.table_schema = 'public'
       AND c.table_name <> '_prisma_migrations'
       AND (c.data_type IN ('text', 'character varying', 'jsonb')
            OR (c.data_type = 'ARRAY' AND c.udt_name IN ('_text', '_varchar')))
  LOOP
    IF col.data_type = 'jsonb' THEN
      EXECUTE format(
        'UPDATE %I SET %I = replace(%I::text, $1, $2)::jsonb WHERE strpos(%I::text, $1) > 0',
        col.table_name, col.column_name, col.column_name, col.column_name)
        USING old_prefix, new_prefix;
    ELSIF col.data_type = 'ARRAY' THEN
      EXECUTE format(
        'UPDATE %I SET %I = (SELECT array_agg(replace(x, $1, $2) ORDER BY i) FROM unnest(%I) WITH ORDINALITY u(x, i))'
        ' WHERE strpos(array_to_string(%I, chr(1)), $1) > 0',
        col.table_name, col.column_name, col.column_name, col.column_name)
        USING old_prefix, new_prefix;
    ELSE
      EXECUTE format(
        'UPDATE %I SET %I = replace(%I, $1, $2) WHERE strpos(%I, $1) > 0',
        col.table_name, col.column_name, col.column_name, col.column_name)
        USING old_prefix, new_prefix;
    END IF;
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN
      RAISE NOTICE 'cdn urls: %.% — % rows', col.table_name, col.column_name, n;
      total := total + n;
    END IF;
  END LOOP;
  RAISE NOTICE 'cdn urls rewritten in % rows', total;
END $$;

COMMIT;

SELECT 'devices' AS what, count(*) FROM "Device"
UNION ALL SELECT 'card tokens', count(*) FROM "CardToken"
UNION ALL SELECT 'pos integrations connected', count(*) FROM "PosIntegration" WHERE status <> 'DISCONNECTED'
UNION ALL SELECT 'brands', count(*) FROM "Brand"
UNION ALL SELECT 'stores', count(*) FROM "Store"
UNION ALL SELECT 'products', count(*) FROM "Product"
UNION ALL SELECT 'orders', count(*) FROM "Order"
UNION ALL SELECT 'users', count(*) FROM "User";
