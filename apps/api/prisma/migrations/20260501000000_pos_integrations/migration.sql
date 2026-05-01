-- Migration: POS integrations (M1 — schema layer)
--
-- Introduces the plug-in POS surface (iiko / Poster) per Brand:
--   * PosIntegration — one connected back-office per (brandId, provider).
--     Credentials stored as AES-256-GCM ciphertext, never plain.
--   * PosSyncJob    — append-only history of menu / stop-list / orders
--                     sync attempts, used by the admin UI for progress.
--
-- Existing catalog entities (Store / Category / Product / Modifier) gain
-- a (externalProvider, externalId) pair so re-imports upsert by external
-- identity instead of duplicating rows. Order gets posExternalId for
-- tracking the corresponding entry in the POS after a successful push.

-- Enums --------------------------------------------------------------------

CREATE TYPE "PosProvider"          AS ENUM ('IIKO', 'POSTER');
CREATE TYPE "PosIntegrationStatus" AS ENUM ('CONNECTED', 'DISCONNECTED', 'ERROR');
CREATE TYPE "PosSyncJobKind"       AS ENUM ('MENU', 'STOP_LIST', 'STORES', 'ORDER_PUSH');
CREATE TYPE "PosSyncJobStatus"     AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- Catalog: external-provider linkage --------------------------------------

ALTER TABLE "Store"
  ADD COLUMN "externalProvider" "PosProvider",
  ADD COLUMN "externalId"       TEXT;

ALTER TABLE "Category"
  ADD COLUMN "externalProvider" "PosProvider",
  ADD COLUMN "externalId"       TEXT;

ALTER TABLE "Product"
  ADD COLUMN "externalProvider" "PosProvider",
  ADD COLUMN "externalId"       TEXT;

ALTER TABLE "Modifier"
  ADD COLUMN "externalProvider" "PosProvider",
  ADD COLUMN "externalId"       TEXT;

ALTER TABLE "Order"
  ADD COLUMN "posExternalId" TEXT;

-- Composite uniqueness — Postgres treats NULLs as distinct by default, so
-- locally-managed rows (NULL external id) never collide.
CREATE UNIQUE INDEX "Store_brandId_externalProvider_externalId_key"
  ON "Store"("brandId", "externalProvider", "externalId");

CREATE UNIQUE INDEX "Category_brandId_externalProvider_externalId_key"
  ON "Category"("brandId", "externalProvider", "externalId");

CREATE UNIQUE INDEX "Product_brandId_externalProvider_externalId_key"
  ON "Product"("brandId", "externalProvider", "externalId");

CREATE UNIQUE INDEX "Modifier_productId_externalProvider_externalId_key"
  ON "Modifier"("productId", "externalProvider", "externalId");

-- PosIntegration -----------------------------------------------------------

CREATE TABLE "PosIntegration" (
  "id"                    TEXT                   NOT NULL,
  "brandId"               TEXT                   NOT NULL,
  "provider"              "PosProvider"          NOT NULL,
  "credentialsCiphertext" TEXT                   NOT NULL,
  "status"                "PosIntegrationStatus" NOT NULL DEFAULT 'DISCONNECTED',
  "settings"              JSONB                  NOT NULL DEFAULT '{}',
  "lastSyncAt"            TIMESTAMP(3),
  "lastErrorMessage"      TEXT,
  "createdAt"             TIMESTAMP(3)           NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3)           NOT NULL,
  CONSTRAINT "PosIntegration_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PosIntegration_brandId_provider_key" ON "PosIntegration"("brandId", "provider");
CREATE INDEX "PosIntegration_brandId_idx"  ON "PosIntegration"("brandId");
CREATE INDEX "PosIntegration_status_idx"   ON "PosIntegration"("status");

ALTER TABLE "PosIntegration"
  ADD CONSTRAINT "PosIntegration_brandId_fkey"
  FOREIGN KEY ("brandId") REFERENCES "Brand"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

-- PosSyncJob ---------------------------------------------------------------

CREATE TABLE "PosSyncJob" (
  "id"            TEXT               NOT NULL,
  "integrationId" TEXT               NOT NULL,
  "kind"          "PosSyncJobKind"   NOT NULL,
  "status"        "PosSyncJobStatus" NOT NULL DEFAULT 'PENDING',
  "progress"      INTEGER            NOT NULL DEFAULT 0,
  "total"         INTEGER            NOT NULL DEFAULT 0,
  "errorMessage"  TEXT,
  "startedAt"     TIMESTAMP(3),
  "finishedAt"    TIMESTAMP(3),
  "createdAt"     TIMESTAMP(3)       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PosSyncJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "PosSyncJob_integrationId_createdAt_idx"      ON "PosSyncJob"("integrationId", "createdAt");
CREATE INDEX "PosSyncJob_integrationId_kind_createdAt_idx" ON "PosSyncJob"("integrationId", "kind", "createdAt");
CREATE INDEX "PosSyncJob_status_idx"                        ON "PosSyncJob"("status");

ALTER TABLE "PosSyncJob"
  ADD CONSTRAINT "PosSyncJob_integrationId_fkey"
  FOREIGN KEY ("integrationId") REFERENCES "PosIntegration"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
