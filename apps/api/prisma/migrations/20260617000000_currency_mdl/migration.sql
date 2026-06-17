-- Add MDL (Moldovan Leu) to the Currency enum.
-- Used by brands operating in Moldova / Transnistria (e.g. NoName Coffee, Tiraspol).
ALTER TYPE "Currency" ADD VALUE IF NOT EXISTS 'MDL';
