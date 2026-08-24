-- Enum values must land in their own migration: PostgreSQL refuses to use a
-- value added by ALTER TYPE inside the same transaction that added it, and the
-- next migration uses AGROPROMBANK as a column default.

-- Transnistrian rouble. No ISO 4217 code exists; Agroprombank's PRB directory
-- numbers it `000`.
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'RUP';

-- ЗАО «Агропромбанк» — tokenized card payments in the «Клевер» scheme.
ALTER TYPE "PaymentProvider" ADD VALUE IF NOT EXISTS 'AGROPROMBANK';
