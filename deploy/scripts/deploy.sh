#!/usr/bin/env bash
# Main deploy entrypoint. Run on the server from /opt/takeaway/repo.
# Idempotent — safe to re-run on every push.
#
# Phases:
#   1. Build the api image (and bring it up, detached).
#   2. Build + extract the four SPAs into /opt/takeaway/www.
#   3. Apply any pending Prisma migrations.
#   4. Reload nginx so it sees freshly-extracted SPA assets.

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DEPLOY_DIR"

echo "==> loading .env.production"
if [ ! -f .env.production ]; then
  echo "ERROR: deploy/.env.production missing. Copy from .env.production.example and fill in." >&2
  exit 1
fi
set -a; source ./.env.production; set +a

echo "==> [0/4] ensure host directories + bootstrap self-signed cert"
mkdir -p /opt/takeaway/www /opt/takeaway/letsencrypt /opt/takeaway/certbot-webroot
bash "$DEPLOY_DIR/scripts/bootstrap-certs.sh"

echo "==> [1/4] building + starting api + dependencies"
docker compose -f docker-compose.prod.yml build api
docker compose -f docker-compose.prod.yml up -d postgres redis

# Wait briefly for postgres to become healthy before running migrations.
echo "==> waiting for postgres to become healthy"
for i in $(seq 1 30); do
  if docker compose -f docker-compose.prod.yml exec -T postgres pg_isready -U "${POSTGRES_USER:-takeaway}" -d "${POSTGRES_DB:-takeaway}" >/dev/null 2>&1; then
    echo "postgres ready"
    break
  fi
  sleep 2
done

echo "==> [2/4] building + extracting SPAs"
bash "$DEPLOY_DIR/scripts/extract-spa.sh"

echo "==> [3/4] applying prisma migrations"
bash "$DEPLOY_DIR/scripts/migrate.sh"

echo "==> [4/4] bringing up api + nginx, reloading config"
docker compose -f docker-compose.prod.yml up -d api nginx
# If nginx was already running, force a reload so it picks up SPA changes.
docker compose -f docker-compose.prod.yml exec -T nginx nginx -s reload 2>/dev/null || true

echo "done."
docker compose -f docker-compose.prod.yml ps
