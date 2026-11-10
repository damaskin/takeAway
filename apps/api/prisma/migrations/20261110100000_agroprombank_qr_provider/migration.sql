-- ЗАО «Агропромбанк» «Мобильный платёж»: an invoice on a QR terminal, paid
-- from the bank's own app (docs/agroprombank-payments.md, section 12).
--
-- In its own migration, like the other enum additions: PostgreSQL refuses to
-- use a value added by ALTER TYPE inside the same transaction that added it.
-- The invoice's external id (`extid`) comes from the existing
-- agroprombank_invoice_seq, so every flow shares one numbering.
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'AGROPROMBANK_QR';
