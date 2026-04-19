#!/usr/bin/env bash
# Runs `prisma migrate deploy` inside the api container against the running
# Postgres. Safe to run repeatedly — prisma tracks what's been applied.

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DEPLOY_DIR"

docker compose -f docker-compose.prod.yml run --rm \
  -e DATABASE_URL="postgresql://${POSTGRES_USER:-takeaway}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-takeaway}?schema=public" \
  --entrypoint=/bin/sh \
  api -c "cd /app && npx prisma migrate deploy --schema=prisma/schema.prisma"
