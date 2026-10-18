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
#   WEB_HOSTS            storefront server names, space-separated, the first one primary
#   API_HOST ADMIN_HOST KDS_HOST TMA_HOST CDN_HOST
#   TLS_CERT_NAME        the Let's Encrypt lineage covering all of them
#   APP_ENVIRONMENT      production | staging — for messages and Sentry

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
else
  : "${APP_ENVIRONMENT:=staging}"
fi
: "${CERTBOT_WEBROOT:=$TAKEAWAY_ROOT/certbot-webroot}"
: "${WEB_HOSTS:=takeaway.md www.takeaway.md}"
: "${API_HOST:=api.takeaway.md}"
: "${ADMIN_HOST:=admin.takeaway.md}"
: "${KDS_HOST:=kds.takeaway.md}"
: "${TMA_HOST:=tma.takeaway.md}"
: "${CDN_HOST:=cdn.takeaway.md}"
: "${TLS_CERT_NAME:=${WEB_HOSTS%% *}}"
WEB_HOST="${WEB_HOSTS%% *}"

export TAKEAWAY_ROOT COMPOSE_PROJECT_NAME IMAGE_TAG CERTBOT_WEBROOT APP_ENVIRONMENT \
  WEB_HOSTS WEB_HOST API_HOST ADMIN_HOST KDS_HOST TMA_HOST CDN_HOST TLS_CERT_NAME

# Every server name of this copy, for the HTTP redirect, the certificate and
# the smoke test.
takeaway_all_hosts() {
  printf '%s\n' $WEB_HOSTS "$API_HOST" "$ADMIN_HOST" "$KDS_HOST" "$TMA_HOST" "$CDN_HOST"
}

# For scripts that touch Docker or the host. A staging checkout that loses a
# line of its .env.production must not fall back to production's defaults:
# compose would then address the production containers (`name: takeaway`),
# and a build would overwrite the image production restarts from. So the
# copy's identity has to agree with where the checkout actually is.
takeaway_require_server_layout() {
  local problem=""
  if [ "$TAKEAWAY_REPO_DIR" != "$TAKEAWAY_ROOT/repo" ]; then
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
    case "$API_HOST" in
      api.takeaway.md) [ -n "$problem" ] || problem="TAKEAWAY_ROOT=$TAKEAWAY_ROOT still has production's host names — set WEB_HOSTS, API_HOST, … in deploy/.env.production" ;;
    esac
  fi
  if [ -n "$problem" ]; then
    echo "ERROR: $problem" >&2
    exit 1
  fi
}
