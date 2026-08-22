#!/usr/bin/env bash
# Post-deploy gate. Exits non-zero if production is not actually serving what
# we just deployed. Run on the server, by deploy.yml or by hand:
#
#   bash /opt/takeaway/repo/deploy/scripts/smoke-test.sh
#
# Deliberately runs from inside the host with `curl --resolve`, bypassing DNS
# and Cloudflare: this asks whether *our* stack is healthy, so a Cloudflare
# hiccup or a bot-challenge served to a CI runner cannot fail a good deploy —
# and, conversely, a green result here plus a broken site points at the CDN.
#
# It never creates production data. Health endpoints only: a smoke test that
# places an order sends a real ticket to a real kitchen.

set -uo pipefail

REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
ATTEMPTS="${SMOKE_ATTEMPTS:-18}"
INTERVAL="${SMOKE_INTERVAL:-10}"
SPA_DOMAINS=(takeaway.md admin.takeaway.md kds.takeaway.md tma.takeaway.md)

EXPECTED="$(git -C "$REPO_DIR" rev-parse HEAD)"
echo "expecting the API to serve $EXPECTED"

# shellcheck disable=SC2001  # the substitution needs a regex, not ${x%%/*}
host_of() { echo "$1" | sed -e 's|https://||' -e 's|/.*||'; }

fetch_url() {
  local url="$1" h
  h="$(host_of "$url")"
  curl -sS --max-time 10 --resolve "$h:443:127.0.0.1" "$url" 2>/dev/null || true
}
code_of() {
  local url="$1" h
  h="$(host_of "$url")"
  curl -sS -o /dev/null -w '%{http_code}' --max-time 10 --resolve "$h:443:127.0.0.1" "$url" 2>/dev/null || echo 000
}

# --- 1. the API must serve the commit we just deployed ---------------------
# Liveness alone is not enough: a container that failed to restart keeps
# answering 200 from the previous build, which is exactly how a deploy
# reports success while shipping nothing.
served=""
for i in $(seq 1 "$ATTEMPTS"); do
  body="$(fetch_url https://api.takeaway.md/api/health)"
  served="$(printf '%s' "$body" | sed -n 's/.*"commit":"\([0-9a-f]\{7,40\}\)".*/\1/p')"
  if [ "$served" = "$EXPECTED" ]; then
    echo "api: serving $served"
    printf '%s\n' "$body"
    break
  fi
  if [ -n "$served" ]; then
    echo "attempt $i/$ATTEMPTS: api is up on $served, waiting for $EXPECTED"
  else
    echo "attempt $i/$ATTEMPTS: no answer from /api/health"
  fi
  [ "$i" = "$ATTEMPTS" ] && {
    echo "FAIL: api is not serving $EXPECTED" >&2
    if [ -n "$served" ]; then
      echo "      it is up on $served — the container did not restart" >&2
    else
      echo "      it did not answer at all. If every domain 502s, the edge is" >&2
      echo "      holding a stale upstream: bash deploy/scripts/edge-nginx.sh reload" >&2
    fi
    exit 1
  }
  sleep "$INTERVAL"
done

# --- 2. dependencies must actually be reachable ----------------------------
# A migration that leaves Postgres unreachable should fail the deploy rather
# than ship quietly behind a healthy-looking liveness probe.
for i in $(seq 1 12); do
  code="$(code_of https://api.takeaway.md/api/health/ready)"
  [ "$code" = "200" ] && { echo "api: dependencies ready"; break; }
  echo "attempt $i/12: /api/health/ready answered $code"
  [ "$i" = 12 ] && {
    echo "FAIL: api is live but not ready — Postgres or Redis is down" >&2
    fetch_url https://api.takeaway.md/api/health/ready >&2
    exit 1
  }
  sleep "$INTERVAL"
done

# --- 3. every SPA must be served, not 502'd --------------------------------
# This is the check that catches a recreated takeaway-nginx-1 whose upstream
# the edge has not picked up yet.
failed=0
for d in "${SPA_DOMAINS[@]}"; do
  code="$(code_of "https://$d/")"
  case "$code" in
    200|301|302) echo "spa: $d $code" ;;
    502) echo "FAIL: $d 502 — the edge is holding a stale upstream" >&2; failed=1 ;;
    *)   echo "FAIL: $d $code" >&2; failed=1 ;;
  esac
done
[ "$failed" = 0 ] || {
  echo "      try: bash deploy/scripts/edge-nginx.sh reload" >&2
  exit 1
}

echo "smoke test passed"
