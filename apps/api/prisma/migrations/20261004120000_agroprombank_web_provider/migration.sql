-- ЗАО «Агропромбанк» «Web-платёж»: the bank's hosted payment page, a second
-- way to take a card alongside the tokenized flow (AGROPROMBANK).
--
-- In its own migration, like the other enum additions: PostgreSQL refuses to
-- use a value added by ALTER TYPE inside the same transaction that added it.
-- Invoice ids (`nivid`) come from the existing agroprombank_invoice_seq, so
-- both flows share one numbering and can never collide.
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'AGROPROMBANK_WEB';
