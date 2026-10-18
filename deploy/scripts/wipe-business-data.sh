#!/usr/bin/env bash
# Clears an environment down to its platform administrators — for production
# the one-time clean start of 2026-10 (docs/environments.md): every brand,
# store, menu, order, payment, promo, campaign and every account except
# SUPER_ADMIN, plus the uploaded pictures and the Redis caches.
#
# Run on the server as root (the backups directory is root's), from that
# environment's checkout:
#
#   bash /opt/takeaway/repo/deploy/scripts/wipe-business-data.sh --yes-wipe-production
#
# (staging: --yes-wipe-staging). Before anything is deleted it writes a full
# backup next to the others in <root>/backups: a pg_dump and a tarball of the
# bucket, both readable by their owner only. Restore with pg_restore and
# `mc mirror` back. The API is stopped for the minute it takes, so nothing
# writes in between.

set -euo pipefail

# shellcheck source=lib/env.sh
. "$(dirname "$0")/lib/env.sh"
takeaway_require_server_layout

if [ "${1:-}" != "--yes-wipe-$APP_ENVIRONMENT" ]; then
  echo "This deletes all business data of $APP_ENVIRONMENT ($TAKEAWAY_ROOT)." >&2
  echo "Re-run with --yes-wipe-$APP_ENVIRONMENT to go ahead." >&2
  exit 2
fi

container_of() {
  docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" --filter "label=com.docker.compose.service=$1" | head -1
}
PG="$(container_of postgres)"
REDIS="$(container_of redis)"
[ -n "$PG" ] || { echo "postgres is not running" >&2; exit 1; }
BUCKET="${S3_BUCKET:-takeaway-uploads}"
DB_USER="${POSTGRES_USER:-takeaway}"
DB="${POSTGRES_DB:-takeaway}"
compose() { docker compose -f "$TAKEAWAY_DEPLOY_DIR/docker-compose.prod.yml" "$@"; }
mc_env="$(mktemp)"
trap 'rm -f "$mc_env"' EXIT
chmod 600 "$mc_env"
printf 'A=%s\nS=%s\n' "${S3_ACCESS_KEY:-}" "${S3_SECRET_KEY:-}" > "$mc_env"
mc_as_me=(--user "$(id -u):$(id -g)" -e MC_CONFIG_DIR=/tmp/.mc --env-file "$mc_env" --network "${COMPOSE_PROJECT_NAME}_default")

ts="$(date -u +%Y%m%dT%H%M%SZ)"
backup_dir="$TAKEAWAY_ROOT/backups"
mkdir -p "$backup_dir"

echo "==> [1/5] stopping the api"
compose stop api

echo "==> [2/5] full backup before the wipe"
umask 077
docker exec "$PG" pg_dump -U "$DB_USER" -d "$DB" -Fc > "$backup_dir/pre-wipe-$ts.dump"
mkdir -p "$backup_dir/pre-wipe-$ts-uploads"
docker run --rm "${mc_as_me[@]}" -v "$backup_dir/pre-wipe-$ts-uploads:/data" --entrypoint sh minio/mc:latest -c \
  "mc alias set s http://minio:9000 \"\$A\" \"\$S\" >/dev/null && mc mirror --quiet s/$BUCKET /data/$BUCKET"
tar -czf "$backup_dir/pre-wipe-$ts-uploads.tar.gz" -C "$backup_dir/pre-wipe-$ts-uploads" .
rm -rf "$backup_dir/pre-wipe-$ts-uploads"
umask 022
ls -la "$backup_dir/pre-wipe-$ts.dump" "$backup_dir/pre-wipe-$ts-uploads.tar.gz"
[ -s "$backup_dir/pre-wipe-$ts.dump" ] || { echo "the backup is empty — stopping before anything is deleted" >&2; compose up -d api; exit 1; }

echo "==> [3/5] deleting business data (one transaction)"
if ! docker exec -i "$PG" psql -q -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB" \
     < "$TAKEAWAY_DEPLOY_DIR/scripts/sql/wipe-business-data.sql"; then
  echo "the wipe failed and was rolled back; nothing was deleted. Starting the api again." >&2
  compose up -d api
  exit 1
fi

echo "==> [4/5] uploaded pictures and caches"
docker run --rm "${mc_as_me[@]}" --entrypoint sh minio/mc:latest -c \
  "mc alias set s http://minio:9000 \"\$A\" \"\$S\" >/dev/null && mc rm --quiet --recursive --force s/$BUCKET/ || true"
# Sessions, cached menus, queued jobs about orders that no longer exist.
[ -n "$REDIS" ] && docker exec "$REDIS" redis-cli FLUSHALL >/dev/null

echo "==> [5/5] starting the api"
compose up -d api
echo "done. backup: $backup_dir/pre-wipe-$ts.dump, $backup_dir/pre-wipe-$ts-uploads.tar.gz"
