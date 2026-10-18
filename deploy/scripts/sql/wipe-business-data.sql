-- Empties a database down to its platform administrators: every brand, store,
-- menu, order, payment, promo, gift card, campaign, notification and every
-- account except SUPER_ADMIN go. The schema, the migration history and the
-- bank's invoice sequence stay. Applied by deploy/scripts/wipe-business-data.sh,
-- which takes a full backup first. docs/environments.md.
--
-- One transaction: either all of it, or — on any error, including a dangling
-- reference found by the check at the end — none of it.

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF (SELECT count(*) FROM "User" WHERE role = 'SUPER_ADMIN') = 0 THEN
    RAISE EXCEPTION 'No SUPER_ADMIN account: nobody could sign in afterwards. Nothing was deleted.';
  END IF;
END $$;

-- Foreign keys are enforced by triggers; replica mode switches them off for
-- this transaction so tables can be emptied in any order. Whatever that could
-- leave dangling is repaired below, and the whole schema is checked before
-- COMMIT.
SET LOCAL session_replication_role = replica;

DO $$
DECLARE
  t record;
  n bigint;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables
     WHERE schemaname = 'public'
       AND tablename NOT IN ('_prisma_migrations', 'User', 'OAuthAccount')
     ORDER BY tablename
  LOOP
    EXECUTE format('DELETE FROM %I', t.tablename);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE 'emptied %: % rows', t.tablename, n; END IF;
  END LOOP;
END $$;

DELETE FROM "OAuthAccount" WHERE "userId" NOT IN (SELECT id FROM "User" WHERE role = 'SUPER_ADMIN');
DELETE FROM "User" WHERE role <> 'SUPER_ADMIN';

-- The administrators' own references into what was just emptied (a KDS PIN
-- store, a referrer, …): cleared. Every single-column foreign key of the
-- kept tables, so a new one is covered too; a NOT NULL one aborts the run.
DO $$
DECLARE
  fk record;
  n bigint;
BEGIN
  FOR fk IN
    SELECT c.conrelid::regclass::text AS child, a.attname AS col,
           c.confrelid::regclass::text AS parent, pa.attname AS pcol
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
     WHERE c.contype = 'f' AND array_length(c.conkey, 1) = 1
       AND c.conrelid::regclass::text IN ('"User"', '"OAuthAccount"')
  LOOP
    EXECUTE format(
      'UPDATE %s ch SET %I = NULL WHERE %I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %s p WHERE p.%I = ch.%I)',
      fk.child, fk.col, fk.col, fk.parent, fk.pcol, fk.col);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE 'cleared %.%: % rows', fk.child, fk.col, n; END IF;
  END LOOP;
END $$;

SET LOCAL session_replication_role = origin;

-- Nothing may point at a row that is gone.
DO $$
DECLARE
  fk record;
  dangling bigint;
BEGIN
  FOR fk IN
    SELECT c.conname, c.conrelid::regclass::text AS child, a.attname AS col,
           c.confrelid::regclass::text AS parent, pa.attname AS pcol
      FROM pg_constraint c
      JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
      JOIN pg_attribute pa ON pa.attrelid = c.confrelid AND pa.attnum = c.confkey[1]
      JOIN pg_namespace ns ON ns.oid = c.connamespace
     WHERE c.contype = 'f' AND ns.nspname = 'public' AND array_length(c.conkey, 1) = 1
  LOOP
    EXECUTE format(
      'SELECT count(*) FROM %s ch WHERE ch.%I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM %s p WHERE p.%I = ch.%I)',
      fk.child, fk.col, fk.parent, fk.pcol, fk.col) INTO dangling;
    IF dangling > 0 THEN
      RAISE EXCEPTION 'Foreign key % (%.% -> %) would dangle in % rows. Nothing was deleted.',
        fk.conname, fk.child, fk.col, fk.parent, dangling;
    END IF;
  END LOOP;
END $$;

-- Materialized views (the analytics' mv_orders_daily, …) still hold the
-- aggregates of what is gone.
DO $$
DECLARE
  mv record;
BEGIN
  FOR mv IN SELECT schemaname, matviewname FROM pg_matviews WHERE schemaname = 'public' LOOP
    EXECUTE format('REFRESH MATERIALIZED VIEW %I.%I', mv.schemaname, mv.matviewname);
    RAISE NOTICE 'refreshed %', mv.matviewname;
  END LOOP;
END $$;

COMMIT;

-- Deliberately untouched: agroprombank_invoice_seq. Invoice numbers must stay
-- unique at the bank across the platform's whole history.

SELECT 'users left' AS what, count(*) FROM "User"
UNION ALL SELECT 'super admins', count(*) FROM "User" WHERE role = 'SUPER_ADMIN'
UNION ALL SELECT 'brands', count(*) FROM "Brand"
UNION ALL SELECT 'stores', count(*) FROM "Store"
UNION ALL SELECT 'products', count(*) FROM "Product"
UNION ALL SELECT 'orders', count(*) FROM "Order";
