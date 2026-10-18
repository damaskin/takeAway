#!/usr/bin/env bash
# Replaces staging's data with a copy of production's, made safe to test on.
# docs/environments.md.
#
# Run on the server as `deploy`, from the STAGING checkout:
#
#   bash /opt/takeaway-staging/repo/deploy/scripts/staging-refresh.sh
#
# Production is only read: one pg_dump and one `mc mirror` out of its bucket.
# Staging's database is dropped and restored from that dump, then
# sql/staging-sanitize.sql cuts everything that could reach a real person or
# a real outside system (push targets, card tokens, POS credentials, unsent
# messages) and points picture URLs at staging's CDN. Then staging's pending
# migrations run — staging may be ahead of production — and the API starts.
#
# Staging is down for the minute this takes; its own data is replaced
# without a backup, because it is by definition a copy.

set -euo pipefail

# shellcheck source=lib/env.sh
. "$(dirname "$0")/lib/env.sh"
takeaway_require_server_layout
if [ "$APP_ENVIRONMENT" != staging ]; then
  echo "staging-refresh.sh replaces the data of staging only (this checkout is $APP_ENVIRONMENT)." >&2
  exit 1
fi

PROD_DEPLOY=/opt/takeaway/repo/deploy
PROD_PROJECT=takeaway
prod_env() { grep -E "^$1=" "$PROD_DEPLOY/.env.production" | head -1 | cut -d= -f2- || true; }

PROD_DB_USER="$(prod_env POSTGRES_USER)"; PROD_DB_USER="${PROD_DB_USER:-takeaway}"
PROD_DB="$(prod_env POSTGRES_DB)"; PROD_DB="${PROD_DB:-takeaway}"
PROD_BUCKET="$(prod_env S3_BUCKET)"; PROD_BUCKET="${PROD_BUCKET:-takeaway-uploads}"
PROD_CDN_BASE="$(prod_env S3_PUBLIC_URL_BASE)"
PROD_CDN_BASE="${PROD_CDN_BASE:-https://cdn.takeaway.md/$PROD_BUCKET}"
STAGING_BUCKET="${S3_BUCKET:-takeaway-uploads}"
STAGING_CDN_BASE="${S3_PUBLIC_URL_BASE:-https://$CDN_HOST/$STAGING_BUCKET}"

container_of() {
  docker ps -q --filter "label=com.docker.compose.project=$1" --filter "label=com.docker.compose.service=$2" | head -1
}
PROD_PG="$(container_of "$PROD_PROJECT" postgres)"
STAGING_PG="$(container_of "$COMPOSE_PROJECT_NAME" postgres)"
STAGING_REDIS="$(container_of "$COMPOSE_PROJECT_NAME" redis)"
[ -n "$PROD_PG" ] || { echo "production's postgres is not running" >&2; exit 1; }
[ -n "$STAGING_PG" ] || { echo "staging's postgres is not running — deploy staging first" >&2; exit 1; }

work="$(mktemp -d)"
chmod 700 "$work"
trap 'rm -rf "$work"' EXIT

compose() { docker compose -f "$TAKEAWAY_DEPLOY_DIR/docker-compose.prod.yml" "$@"; }

echo "==> [1/6] dumping production (read-only)"
docker exec "$PROD_PG" pg_dump -U "$PROD_DB_USER" -d "$PROD_DB" -Fc --no-owner --no-privileges > "$work/prod.dump"
echo "    $(du -h "$work/prod.dump" | cut -f1)"

echo "==> [2/6] copying production's uploads (read-only)"
umask 077
printf 'A=%s\nS=%s\n' "$(prod_env S3_ACCESS_KEY)" "$(prod_env S3_SECRET_KEY)" > "$work/prod-s3.env"
printf 'A=%s\nS=%s\n' "${S3_ACCESS_KEY:-}" "${S3_SECRET_KEY:-}" > "$work/staging-s3.env"
umask 022
# As this user, so the copied files can be cleaned up without root.
mc_as_me=(--user "$(id -u):$(id -g)" -e MC_CONFIG_DIR=/tmp/.mc)
mkdir -p "$work/s3/bucket"
docker run --rm "${mc_as_me[@]}" --network "${PROD_PROJECT}_default" --env-file "$work/prod-s3.env" \
  -v "$work/s3:/data" --entrypoint sh minio/mc:latest -c \
  "mc alias set p http://minio:9000 \"\$A\" \"\$S\" >/dev/null && mc mirror --quiet --overwrite p/$PROD_BUCKET /data/bucket"
echo "    $(find "$work/s3" -type f | wc -l) files"

echo "==> [3/6] stopping staging's api"
compose stop api

echo "==> [4/6] restoring into staging and sanitizing"
docker exec "$STAGING_PG" psql -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
  -c 'DROP SCHEMA public CASCADE; CREATE SCHEMA public;'
docker exec -i "$STAGING_PG" pg_restore --no-owner --no-privileges --exit-on-error \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$work/prod.dump"
docker exec -i "$STAGING_PG" psql -q -v ON_ERROR_STOP=1 \
  -v old_cdn="$PROD_CDN_BASE/" -v new_cdn="$STAGING_CDN_BASE/" \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" < "$TAKEAWAY_DEPLOY_DIR/scripts/sql/staging-sanitize.sql"
# Cached menus, co-purchase counts and sessions describe the old data.
[ -n "$STAGING_REDIS" ] && docker exec "$STAGING_REDIS" redis-cli FLUSHALL >/dev/null

echo "==> [5/6] staging's pending migrations"
bash "$TAKEAWAY_DEPLOY_DIR/scripts/migrate.sh"

echo "==> [6/6] uploads into staging's bucket, api back up"
docker run --rm "${mc_as_me[@]}" --network "${COMPOSE_PROJECT_NAME}_default" --env-file "$work/staging-s3.env" \
  -v "$work/s3:/data:ro" --entrypoint sh minio/mc:latest -c \
  "mc alias set s http://minio:9000 \"\$A\" \"\$S\" >/dev/null && mc mb --ignore-existing s/$STAGING_BUCKET >/dev/null \
   && mc mirror --quiet --overwrite --remove /data/bucket s/$STAGING_BUCKET && mc anonymous set download s/$STAGING_BUCKET >/dev/null"
compose up -d api
for i in $(seq 1 30); do
  state="$(docker inspect -f '{{.State.Health.Status}}' "$(container_of "$COMPOSE_PROJECT_NAME" api)" 2>/dev/null || true)"
  [ "$state" = healthy ] && break
  sleep 5
done
echo "    api: ${state:-unknown}"
echo "staging now holds production's data as of $(date -u +%FT%TZ)."
