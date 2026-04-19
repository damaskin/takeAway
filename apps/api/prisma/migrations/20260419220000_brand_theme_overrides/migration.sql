-- Per-brand theme overrides. A JSON blob of `{ "--css-var": "value" }` pairs
-- that TMA (and optionally web) merges on top of the Telegram theme so
-- brand identity bleeds through the platform palette.
ALTER TABLE "Brand" ADD COLUMN "themeOverrides" JSONB;
