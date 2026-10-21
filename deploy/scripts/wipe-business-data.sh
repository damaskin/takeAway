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
# backup next to the others in <root>/backups, encrypted with
# BACKUP_ENCRYPTION_KEY like every backup there (lib/backup.sh) and expiring
# with them after 30 days: pre-wipe-<time>.sql.gz.enc, the database, and
# pre-wipe-<time>-uploads.tar.gz.enc, the bucket. Restore the database with
# the command in lib/backup.sh; the pictures — decrypt the same way, untar and
# `mc mirror` back. The API is stopped for the minute it takes, so nothing
# writes in between.
#
# Production refuses to run without the key. Staging without one is wiped
# without a backup: it is a copy, and staging-refresh.sh makes it again.

set -euo pipefail

# shellcheck source=lib/env.sh
. "$(dirname "$0")/lib/env.sh"
takeaway_require_server_layout
# shellcheck source=lib/backup.sh
. "$(dirname "$0")/lib/backup.sh"

if [ "${1:-}" != "--yes-wipe-$APP_ENVIRONMENT" ]; then
  echo "This deletes all business data of $APP_ENVIRONMENT ($TAKEAWAY_ROOT)." >&2
  echo "Re-run with --yes-wipe-$APP_ENVIRONMENT to go ahead." >&2
  exit 2
fi
backup=1
if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  if [ "$APP_ENVIRONMENT" = staging ]; then
    echo "No BACKUP_ENCRYPTION_KEY on staging — wiping without a backup (staging-refresh.sh makes the copy again)."
    backup=0
  else
    takeaway_require_backup_key || exit 1
  fi
fi
cd "$TAKEAWAY_DEPLOY_DIR"

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
db_backup="$TAKEAWAY_BACKUP_DIR/pre-wipe-$ts.sql.gz.enc"
uploads_backup="$TAKEAWAY_BACKUP_DIR/pre-wipe-$ts-uploads.tar.gz.enc"

# The database, then the bucket. The pictures pass through a directory on the
# way to the tarball — they are what the CDN serves publicly anyway — and the
# tarball is encrypted like the dump.
backup_before_wipe() {
  local pics="$TAKEAWAY_BACKUP_DIR/pre-wipe-$ts-uploads" ok=1
  takeaway_dump_encrypted "$db_backup" || return 1
  (umask 077 && mkdir -p "$pics")
  if ! docker run --rm "${mc_as_me[@]}" -v "$pics:/data" --entrypoint sh minio/mc:latest -c \
         "mc alias set s http://minio:9000 \"\$A\" \"\$S\" >/dev/null && mc mirror --quiet s/$BUCKET /data/$BUCKET" \
     || ! (set -o pipefail && umask 077 && tar -czf - -C "$pics" . | takeaway_encrypt > "$uploads_backup"); then
    ok=0
    rm -f "$uploads_backup"
  fi
  rm -rf "$pics"
  if [ "$ok" = 0 ]; then
    echo "could not back up the uploaded pictures" >&2
    return 1
  fi
  ls -la "$db_backup" "$uploads_backup"
}

echo "==> [1/5] stopping the api"
compose stop api

echo "==> [2/5] full backup before the wipe"
if [ "$backup" = 1 ]; then
  if ! backup_before_wipe; then
    echo "the backup failed — stopping before anything is deleted" >&2
    compose up -d api
    exit 1
  fi
else
  echo "    skipped"
fi

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
if [ "$backup" = 1 ]; then
  echo "done. backup: $db_backup, $uploads_backup"
else
  echo "done, without a backup."
fi
