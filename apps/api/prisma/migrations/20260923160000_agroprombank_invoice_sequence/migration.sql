-- Agroprombank invoice ids come from a sequence: short numbers, like the
-- bank's own example (123456). The timestamp + random ids before ran to 18
-- digits, and every charge that carried one failed inside the bank
-- ("Произошла ошибка").
-- Prisma does not model standalone sequences; the service reads it with
-- SELECT nextval('agroprombank_invoice_seq').
CREATE SEQUENCE IF NOT EXISTS "agroprombank_invoice_seq" START WITH 100000 MINVALUE 100000;
