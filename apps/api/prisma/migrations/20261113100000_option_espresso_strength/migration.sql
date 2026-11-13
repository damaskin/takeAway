-- Maxim's marks on list 5.0, item 4.6 (2026-11-12): the espresso variant group
-- reads «Крепость», and each shot says what it is in a short hint under the
-- name — the same second line the sizes use («M» + «300–350 мл»).
--
-- Only the seeded group is touched, and only while takeAway has not renamed
-- it already; the rename is skipped when another group took «Крепость» (the
-- name is unique). A hint someone already wrote is kept.

UPDATE "OptionGroup"
SET "name" = 'Крепость', "updatedAt" = CURRENT_TIMESTAMP
WHERE "id" = 'og_espresso'
  AND "name" = 'Эспрессо'
  AND NOT EXISTS (SELECT 1 FROM "OptionGroup" WHERE "name" = 'Крепость');

UPDATE "OptionItem" AS item
SET "note" = hint.note, "updatedAt" = CURRENT_TIMESTAMP
FROM (VALUES
  ('oi_espresso_ristretto', 'крепче, меньше объём'),
  ('oi_espresso_espresso', 'классика'),
  ('oi_espresso_doppio', 'двойная порция'),
  ('oi_espresso_lungo', 'мягче, больше объём')
) AS hint(id, note)
WHERE item."id" = hint.id
  AND item."groupId" = 'og_espresso'
  AND (item."note" IS NULL OR item."note" = '');
