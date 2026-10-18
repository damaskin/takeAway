#!/usr/bin/env bash
# Runs `prisma migrate deploy` inside the api container against the running
# Postgres. Safe to run repeatedly — prisma tracks what's been applied.

set -euo pipefail

# shellcheck source=lib/env.sh
. "$(dirname "$0")/lib/env.sh"
takeaway_require_server_layout
cd "$TAKEAWAY_DEPLOY_DIR"

docker compose -f docker-compose.prod.yml run --rm \
  -e DATABASE_URL="postgresql://${POSTGRES_USER:-takeaway}:${POSTGRES_PASSWORD}@postgres:5432/${POSTGRES_DB:-takeaway}?schema=public" \
  --entrypoint=/bin/sh \
  api -c "cd /app && npx prisma migrate deploy --schema=prisma/schema.prisma"
