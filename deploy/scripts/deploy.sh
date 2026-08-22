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
set -a; source ./.env.production; set +a

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
if [ "$missing" = "1" ]; then
  echo "Generate POS_CREDENTIALS_KEY with: openssl rand -hex 32" >&2
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

echo "==> [0/4] ensure host directories + bootstrap self-signed cert"
mkdir -p /opt/takeaway/www /opt/takeaway/letsencrypt /opt/takeaway/certbot-webroot
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
compose up -d api nginx minio
# Reload our own nginx first, so it picks up vhost / snippet changes.
compose exec -T nginx nginx -s reload 2>/dev/null || true

if [ "$SHARED_EDGE" = "1" ]; then
  # edge-nginx fronts us with SNI passthrough (ssl_preread) and caches the
  # upstream address, so a recreated takeaway-nginx-1 leaves it pointing at a
  # container that no longer exists — every domain 502s until the edge
  # reloads. This step is therefore load-bearing, not best-effort.
  #
  # (Reloading is all we do to the edge. takeAway containers must NOT join
  # rayn-prod_default: the other project's postgres resolves there and Prisma
  # dies with P1000 on credentials that are not ours.)
  edge_reloaded=0

  # Preferred: drive it through the other project's compose file, if the
  # checkout is where it used to be.
  if [ -f /opt/rayn-repo/infra/deploy/docker-compose.prod.yml ]; then
    if (cd /opt/rayn-repo/infra/deploy \
        && docker compose --env-file .env.prod -f docker-compose.prod.yml \
             exec -T nginx nginx -s reload) >/dev/null 2>&1; then
      edge_reloaded=1
    fi
  fi

  # Fallback: talk to the container directly. This is what actually works on
  # the current host — the compose path above silently did nothing once the
  # neighbouring repo moved, and the 502s that followed looked like our bug.
  if [ "$edge_reloaded" = "0" ] && docker exec edge-nginx nginx -s reload >/dev/null 2>&1; then
    edge_reloaded=1
  fi

  if [ "$edge_reloaded" = "1" ]; then
    echo "    edge-nginx reloaded"
  else
    # Deliberately not fatal: the deploy itself succeeded, and failing here
    # would strand a good build. But it must be shouted, because the symptom
    # is a total outage that looks nothing like a reload problem.
    echo "!!  WARNING: could not reload edge-nginx." >&2
    echo "!!  If the site 502s, run: docker exec edge-nginx nginx -s reload" >&2
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
