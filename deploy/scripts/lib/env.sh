# Which environment this checkout deploys, for every script in deploy/scripts.
# Sourced, never run:  . "$(dirname "$0")/lib/env.sh"
#
# One server runs two copies of the stack side by side (docs/environments.md):
#
#   production  /opt/takeaway          compose project takeaway          takeaway.md, api.…, admin.…
#   staging     /opt/takeaway-staging  compose project takeaway-staging  test.takeaway.md, test-api.…, …
#
# Each copy is a checkout at <root>/repo with its own deploy/.env.production.
# Everything that differs between the two comes from that file; the defaults
# below are production's, so production's own file needs none of it.
#
# The variables this settles, exported for docker compose and the scripts:
#   TAKEAWAY_ROOT        host directory of this copy (www, letsencrypt, secrets, repo)
#   COMPOSE_PROJECT_NAME compose project — container, volume and network names
#   IMAGE_TAG            tag of the locally built images (takeaway/api:<tag>, …)
#   CERTBOT_WEBROOT      where certbot leaves HTTP-01 challenges for the edge to serve
#   DOMAIN_WEB           storefront server names, space-separated, the first one primary
#   DOMAIN_API DOMAIN_ADMIN DOMAIN_KDS DOMAIN_TMA DOMAIN_CDN
#   TLS_CERT_NAME        the Let's Encrypt lineage covering all of them
#   APP_ENVIRONMENT      production | staging — for messages and Sentry
#   ROBOTS_TAG           X-Robots-Tag for every site; empty (none) in production
#   EXTRA_COMPOSE_FILES  compose files laid over the stack, by name in deploy/,
#                        space-separated; staging only (takeaway_compose_files)
#
# The api container reads the whole file (env_file), so these names must not
# mean anything to the API. The host names are DOMAIN_* for that reason:
# API_HOST is the API's listen address (apps/api/src/main.ts), and a host
# name there makes it try to listen on Cloudflare's IP.

TAKEAWAY_DEPLOY_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TAKEAWAY_REPO_DIR="$(cd "$TAKEAWAY_DEPLOY_DIR/.." && pwd)"
TAKEAWAY_PROD_ROOT=/opt/takeaway

# deploy/.env.production is optional here: CI renders the nginx config
# without one, from the defaults or from variables it sets itself.
if [ -f "$TAKEAWAY_DEPLOY_DIR/.env.production" ]; then
  # shellcheck disable=SC1091
  set -a; . "$TAKEAWAY_DEPLOY_DIR/.env.production"; set +a
fi

: "${TAKEAWAY_ROOT:=$TAKEAWAY_PROD_ROOT}"
TAKEAWAY_ROOT="${TAKEAWAY_ROOT%/}"

if [ "$TAKEAWAY_ROOT" = "$TAKEAWAY_PROD_ROOT" ]; then
  : "${COMPOSE_PROJECT_NAME:=takeaway}"
  : "${IMAGE_TAG:=local}"
  : "${APP_ENVIRONMENT:=production}"
  : "${ROBOTS_TAG=}"
else
  : "${APP_ENVIRONMENT:=staging}"
  : "${ROBOTS_TAG=noindex, nofollow}"
fi
: "${CERTBOT_WEBROOT:=$TAKEAWAY_ROOT/certbot-webroot}"
: "${DOMAIN_WEB:=takeaway.md www.takeaway.md}"
: "${DOMAIN_API:=api.takeaway.md}"
: "${DOMAIN_ADMIN:=admin.takeaway.md}"
: "${DOMAIN_KDS:=kds.takeaway.md}"
: "${DOMAIN_TMA:=tma.takeaway.md}"
: "${DOMAIN_CDN:=cdn.takeaway.md}"
: "${TLS_CERT_NAME:=${DOMAIN_WEB%% *}}"
DOMAIN_WEB_PRIMARY="${DOMAIN_WEB%% *}"
: "${EXTRA_COMPOSE_FILES=}"

export TAKEAWAY_ROOT COMPOSE_PROJECT_NAME IMAGE_TAG CERTBOT_WEBROOT APP_ENVIRONMENT ROBOTS_TAG \
  DOMAIN_WEB DOMAIN_WEB_PRIMARY DOMAIN_API DOMAIN_ADMIN DOMAIN_KDS DOMAIN_TMA DOMAIN_CDN TLS_CERT_NAME \
  EXTRA_COMPOSE_FILES

# Every server name of this copy, for the HTTP redirect, the certificate and
# the smoke test.
takeaway_all_hosts() {
  printf '%s\n' $DOMAIN_WEB "$DOMAIN_API" "$DOMAIN_ADMIN" "$DOMAIN_KDS" "$DOMAIN_TMA" "$DOMAIN_CDN"
}

# For scripts that touch Docker or the host. A staging checkout that loses a
# line of its .env.production must not fall back to production's defaults:
# compose would then address the production containers (`name: takeaway`),
# and a build would overwrite the image production restarts from. So the
# copy's identity has to agree with where the checkout actually is.
takeaway_require_server_layout() {
  local problem=""
  case "${API_HOST:-0.0.0.0}" in
    0.0.0.0|::|127.0.0.1) ;;
    *) problem="API_HOST=$API_HOST in deploy/.env.production is the API's listen address, not a host name — the host names are DOMAIN_*" ;;
  esac
  if [ -n "$problem" ]; then
    :
  elif [ "$TAKEAWAY_REPO_DIR" != "$TAKEAWAY_ROOT/repo" ]; then
    problem="this checkout is $TAKEAWAY_REPO_DIR, but TAKEAWAY_ROOT=$TAKEAWAY_ROOT expects $TAKEAWAY_ROOT/repo"
  elif [ "$TAKEAWAY_ROOT" = "$TAKEAWAY_PROD_ROOT" ]; then
    [ "$COMPOSE_PROJECT_NAME" = takeaway ] || problem="production must be compose project 'takeaway', not '$COMPOSE_PROJECT_NAME'"
  else
    case "${COMPOSE_PROJECT_NAME:-}" in
      ''|takeaway) problem="TAKEAWAY_ROOT=$TAKEAWAY_ROOT needs its own COMPOSE_PROJECT_NAME in deploy/.env.production" ;;
    esac
    case "${IMAGE_TAG:-}" in
      ''|local) [ -n "$problem" ] || problem="TAKEAWAY_ROOT=$TAKEAWAY_ROOT needs its own IMAGE_TAG in deploy/.env.production" ;;
    esac
    case "$DOMAIN_API" in
      api.takeaway.md) [ -n "$problem" ] || problem="TAKEAWAY_ROOT=$TAKEAWAY_ROOT still has production's host names — set DOMAIN_WEB, DOMAIN_API, … in deploy/.env.production" ;;
    esac
  fi
  if [ -n "$problem" ]; then
    echo "ERROR: $problem" >&2
    exit 1
  fi
}

# The compose files of this copy, as `docker compose` arguments in the array
# TAKEAWAY_COMPOSE_FILES: the stack, the shared-edge override where the server
# has one, and what EXTRA_COMPOSE_FILES in deploy/.env.production names. Every
# script that starts or recreates a service uses it — one that left the extra
# files out would recreate the api without what they set.
#
# Not COMPOSE_FILE (or any COMPOSE_* name): compose reads those from .env, the
# symlink to .env.production, by itself.
#
# Extra files are for staging alone. docker-compose.staging.yml runs a fake
# bank, and a production that picked it up would take customers' orders
# against it — so a production copy, by any sign of being one, refuses them.
takeaway_compose_files() {
  TAKEAWAY_COMPOSE_FILES=(-f "$TAKEAWAY_DEPLOY_DIR/docker-compose.prod.yml")
  if [ -f "$TAKEAWAY_DEPLOY_DIR/docker-compose.shared-edge.override.yml" ]; then
    TAKEAWAY_COMPOSE_FILES+=(-f "$TAKEAWAY_DEPLOY_DIR/docker-compose.shared-edge.override.yml")
  fi
  [ -n "${EXTRA_COMPOSE_FILES// /}" ] || return 0

  if [ "$TAKEAWAY_ROOT" = "$TAKEAWAY_PROD_ROOT" ] || [ "$TAKEAWAY_REPO_DIR" = "$TAKEAWAY_PROD_ROOT/repo" ] \
    || [ "$APP_ENVIRONMENT" = production ] || [ "$COMPOSE_PROJECT_NAME" = takeaway ] \
    || [ "$DOMAIN_API" = api.takeaway.md ]; then
    echo "ERROR: EXTRA_COMPOSE_FILES=$EXTRA_COMPOSE_FILES in production's deploy/.env.production —" >&2
    echo "       extra compose files are for staging only (docker-compose.staging.yml is a fake bank)." >&2
    exit 1
  fi
  local name
  for name in $EXTRA_COMPOSE_FILES; do
    case "$name" in
      */* | .*) echo "ERROR: EXTRA_COMPOSE_FILES names files in deploy/ by name only, not '$name'" >&2; exit 1 ;;
    esac
    if [ ! -f "$TAKEAWAY_DEPLOY_DIR/$name" ]; then
      echo "ERROR: EXTRA_COMPOSE_FILES names $name, which is not in $TAKEAWAY_DEPLOY_DIR" >&2
      exit 1
    fi
    TAKEAWAY_COMPOSE_FILES+=(-f "$TAKEAWAY_DEPLOY_DIR/$name")
  done
}
