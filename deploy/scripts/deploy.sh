#!/usr/bin/env bash
# Main deploy entrypoint. Run on the server from <root>/repo — /opt/takeaway/repo
# for production, /opt/takeaway-staging/repo for staging (docs/environments.md).
# Which one is decided by deploy/.env.production (scripts/lib/env.sh).
# Idempotent — safe to re-run on every push.
#
# Phases:
#   -  Production only: an encrypted snapshot of the database, before
#      anything changes (snapshot-db.sh).
#   0. Render this environment's nginx vhosts.
#   1. Build the api image (and bring it up, detached).
#   2. Build + extract the SPAs into <root>/www.
#   3. Apply any pending Prisma migrations.
#   4. Reload nginx so it sees freshly-extracted SPA assets.

set -euo pipefail

# Taken from the caller before .env.production is read, so it can only ever
# be one hand-run's decision, never a line someone left in the file.
skip_snapshot="${SKIP_PRE_DEPLOY_SNAPSHOT:-}"

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DEPLOY_DIR"

COMPOSE_FILES=(-f docker-compose.prod.yml)
SHARED_EDGE=0
if [ -f docker-compose.shared-edge.override.yml ]; then
  COMPOSE_FILES+=(-f docker-compose.shared-edge.override.yml)
  SHARED_EDGE=1
fi
compose() { docker compose "${COMPOSE_FILES[@]}" "$@"; }

echo "==> loading .env.production"
if [ ! -f .env.production ]; then
  echo "ERROR: deploy/.env.production missing. Copy from .env.production.example and fill in." >&2
  exit 1
fi
# shellcheck source=lib/env.sh
. "$DEPLOY_DIR/scripts/lib/env.sh"
takeaway_require_server_layout
echo "==> environment: $APP_ENVIRONMENT — $TAKEAWAY_ROOT, compose project $COMPOSE_PROJECT_NAME, images :$IMAGE_TAG"

# Pre-flight: vars the API hard-requires on boot. A missing one used to put
# the api container into a CrashLoopBackOff with nginx serving 502 — fail
# fast here instead of after a 20-minute SPA build.
REQUIRED_VARS=(
  POSTGRES_PASSWORD
  JWT_ACCESS_SECRET
  JWT_REFRESH_SECRET
  POS_CREDENTIALS_KEY
)
missing=0
for v in "${REQUIRED_VARS[@]}"; do
  if [ -z "${!v:-}" ]; then
    echo "ERROR: $v is required in .env.production but is empty/unset." >&2
    missing=1
  fi
done
# The API refuses to start in production with a placeholder JWT secret (a
# secret that is in the repository signs tokens anyone can forge). Say so
# here, before the build, rather than in a crash-looping container.
for v in JWT_ACCESS_SECRET JWT_REFRESH_SECRET; do
  case "${!v:-}" in
    CHANGE_ME|change-me-in-prod-*)
      echo "ERROR: $v in .env.production is still a placeholder." >&2
      missing=1
      ;;
  esac
done
if [ "$missing" = "1" ]; then
  echo "Generate POS_CREDENTIALS_KEY / JWT secrets with: openssl rand -hex 32" >&2
  exit 1
fi

# Compute the version triple once and export it to every downstream step
# (Dockerfile.api ARGs, extract-spa.sh's version.json writer). Tags are not
# required — `git describe --always` falls back to a short SHA, and `--dirty`
# flags any local edits the deploy user might have applied on the box.
BUILD_VERSION="$(git -C "$(cd "$DEPLOY_DIR/.." && pwd)" describe --tags --always --dirty 2>/dev/null || echo dev)"
BUILD_COMMIT="$(git -C "$(cd "$DEPLOY_DIR/.." && pwd)" rev-parse HEAD 2>/dev/null || echo unknown)"
BUILD_TIME="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
export BUILD_VERSION BUILD_COMMIT BUILD_TIME
echo "==> build version: $BUILD_VERSION ($BUILD_COMMIT) at $BUILD_TIME"

# A production release snapshots the database before anything below can
# change it — the vhosts, the images and above all the migrations:
# backups/pre-deploy-<version>-<UTC time>.sql.gz.enc, encrypted like every
# file there and expired after 30 days (lib/backup.sh). It replaces the
# pg_dump people used to take by hand before a release, which was plaintext
# and never expired.
#
# Fatal when it fails: nothing has changed yet, so the cost is a re-run once
# the cause is fixed, and each cause says what to fix. A release that went
# ahead anyway would leave a bad migration nothing newer than last night's
# backup to go back to. Not taken on staging (a copy of production, made
# again by staging-refresh.sh) or on a first deploy, which has no database
# yet. SKIP_PRE_DEPLOY_SNAPSHOT is for a hand-run when production is down
# and this deploy is the fix; CI cannot set it.
running_postgres() {
  docker ps -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
    --filter "label=com.docker.compose.service=postgres" | head -1
}
postgres_volume() {
  docker volume ls -q --filter "label=com.docker.compose.project=$COMPOSE_PROJECT_NAME" \
    --filter "label=com.docker.compose.volume=postgres_data" | head -1
}
if [ "$APP_ENVIRONMENT" != production ]; then
  :
elif [ -n "$skip_snapshot" ]; then
  echo "!!  WARNING: SKIP_PRE_DEPLOY_SNAPSHOT ($skip_snapshot) — deploying production without a snapshot." >&2
  echo "!!  The newest way back is last night's backup." >&2
elif [ -n "$(running_postgres)" ]; then
  echo "==> snapshot of the production database before the deploy"
  if ! bash "$DEPLOY_DIR/scripts/snapshot-db.sh" "deploy-$BUILD_VERSION"; then
    echo "ERROR: no pre-deploy snapshot (the reason is above), so nothing was deployed — production is unchanged." >&2
    echo "Fix that and run the deploy again." >&2
    exit 1
  fi
elif [ -n "$(postgres_volume)" ]; then
  echo "ERROR: production's database exists but postgres is not running, so it cannot be snapshotted" >&2
  echo "before the deploy. Nothing was deployed. Start it and run the deploy again:" >&2
  echo "  cd $DEPLOY_DIR && docker compose -f docker-compose.prod.yml start postgres" >&2
  echo "If it will not start and this deploy is the fix, run by hand on the server:" >&2
  echo "  SKIP_PRE_DEPLOY_SNAPSHOT='<why>' bash $DEPLOY_DIR/scripts/deploy.sh" >&2
  exit 1
else
  echo "==> no production database yet — first deploy, nothing to snapshot"
  # Made now, as deploy, so the nightly (root) does not create it root's
  # and stop the next release (lib/backup.sh, takeaway_require_backup_dir).
  (umask 027 && mkdir -p "$TAKEAWAY_ROOT/backups")
fi

echo "==> [0/4] render nginx vhosts, ensure host directories + bootstrap self-signed cert"
# First, before anything slow: git has just replaced the templates, and the
# rendered vhosts must match them before anything can reload nginx.
bash "$DEPLOY_DIR/scripts/render-nginx.sh"
mkdir -p "$TAKEAWAY_ROOT/www" "$TAKEAWAY_ROOT/letsencrypt" "$CERTBOT_WEBROOT"
# Bank key material lives here and is mounted read-only into the api
# container. Created empty; the PEMs are placed by hand, once.
#
# 0751, not 0700: the api container runs as uid 10001, which is not the deploy
# user, so it needs to traverse this directory to open the key. It cannot list
# the contents, and each file carries its own mode — the private key is 0400
# owned by 10001, the certificates are world-readable because certificates are
# public. See docs/agroprombank-payments.md.
mkdir -p "$TAKEAWAY_ROOT/secrets" && chmod 751 "$TAKEAWAY_ROOT/secrets"
# Ensure docker compose auto-picks the production env for variable substitution.
# The `.env` filename is compose's default; we keep the canonical file named
# .env.production and symlink .env -> .env.production so ad-hoc compose
# commands in this directory interpolate the right values.
ln -sf .env.production "$DEPLOY_DIR/.env"
bash "$DEPLOY_DIR/scripts/bootstrap-certs.sh"

echo "==> [1/4] building + starting api + dependencies"
# `compose` carries the shared-edge override; the build args stamp the
# version triple that /api/health, /version.json and the Sentry release all
# read back.
compose build \
  --build-arg "BUILD_VERSION=$BUILD_VERSION" \
  --build-arg "BUILD_COMMIT=$BUILD_COMMIT" \
  --build-arg "BUILD_TIME=$BUILD_TIME" \
  api
compose up -d postgres redis minio
# One-shot bucket setup. Safe to re-run; exits 0 when the bucket is ready.
compose up minio-init --exit-code-from minio-init || true

# Wait briefly for postgres to become healthy before running migrations.
echo "==> waiting for postgres to become healthy"
for i in $(seq 1 30); do
  if compose exec -T postgres pg_isready -U "${POSTGRES_USER:-takeaway}" -d "${POSTGRES_DB:-takeaway}" >/dev/null 2>&1; then
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
compose up -d api minio
# Test the checked-out nginx config before the live nginx sees it, in a
# throwaway container of the same service (same image, mounts, networks —
# so upstream names resolve). A reload of a broken config used to fail
# silently and leave the old config running; a restart would then not
# come up at all.
echo "==> testing the nginx config"
if ! compose run --rm --no-deps -T nginx nginx -t; then
  echo "ERROR: the nginx config in this checkout fails nginx -t; the live nginx keeps its current config." >&2
  exit 1
fi
# nginx.conf is bind-mounted as a single file. git replaces the file on
# checkout and the running container keeps the old one, while conf.d/ and
# snippets/ are directory mounts and follow — so a reload alone pairs new
# vhosts with an old nginx.conf. When nginx.conf changed, recreate.
live_conf=$(compose exec -T nginx sha1sum /etc/nginx/nginx.conf 2>/dev/null | cut -d' ' -f1 || true)
repo_conf=$(sha1sum nginx/nginx.conf | cut -d' ' -f1)
if [ "$live_conf" != "$repo_conf" ]; then
  echo "==> nginx.conf changed — recreating the nginx container"
  compose up -d --no-deps --force-recreate nginx
else
  compose up -d nginx
  compose exec -T nginx nginx -s reload
fi

if [ "$SHARED_EDGE" = "1" ]; then
  # The edge fronts us with SNI passthrough and caches the upstream address,
  # so a recreated takeaway-nginx-1 leaves every domain serving 502 until it
  # reloads. Load-bearing, not best-effort — and the container's name is
  # discovered rather than guessed (see edge-nginx.sh for why).
  if ! bash "$DEPLOY_DIR/scripts/edge-nginx.sh" reload; then
    # Deliberately not fatal: the deploy itself succeeded and failing here
    # would strand a good build. But it must be shouted, because the symptom
    # is a total outage that looks nothing like a missed reload.
    echo "!!  WARNING: could not reload the edge nginx." >&2
    echo "!!  If the site 502s, find it and reload by hand:" >&2
    echo "!!    bash deploy/scripts/edge-nginx.sh find" >&2
    echo "!!    docker exec <name> nginx -s reload" >&2
  fi
fi

echo "==> [5/5] pruning Docker build cache + dangling images"
# The build cache speeds up rebuilds but grows unbounded across deploys —
# a single deploy adds several GB, and a full disk has taken down prod
# before. Cap the cache at 3 GB (keeps recent layers so back-to-back
# deploys stay fast, evicts the oldest beyond that) and drop images no
# container references anymore. Never touches volumes / data.
docker builder prune -f --max-used-space=3GB || docker builder prune -f || true
docker image prune -f || true

echo "done."
compose ps
df -h /
