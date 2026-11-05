-- «Базовое время на заказ» is now «Время для принятия заказа» (manager's list
-- 5.0, items 6 and 9): whole minutes from 1 to 60, half of it reminds the
-- kitchen to accept an order, all of it cancels the order. The column keeps
-- its name. A store with less than a minute (the old form allowed 0) gets the
-- default 10 minutes; any other value is rounded to whole minutes, at most 60.
UPDATE "Store" SET "baseEtaSeconds" = 600 WHERE "baseEtaSeconds" < 60;
UPDATE "Store"
SET "baseEtaSeconds" = LEAST(3600, ROUND("baseEtaSeconds" / 60.0) * 60)::int
WHERE "baseEtaSeconds" % 60 <> 0 OR "baseEtaSeconds" > 3600;
