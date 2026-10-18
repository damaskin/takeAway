#!/usr/bin/env bash
# First step of any takeAway production investigation. Read-only: it inspects
# and reports, it never restarts, rebuilds or writes anything.
#
# Run on the server:  bash /opt/takeaway/repo/deploy/scripts/server-check.sh
# (staging: /opt/takeaway-staging/repo/…)

set -uo pipefail

# shellcheck source=lib/env.sh
. "$(dirname "$0")/lib/env.sh"
DEPLOY_DIR="$TAKEAWAY_DEPLOY_DIR"
REPO_DIR="$TAKEAWAY_REPO_DIR"
cd "$DEPLOY_DIR"

DOMAINS=("$WEB_HOST" "$API_HOST" "$ADMIN_HOST" "$KDS_HOST" "$TMA_HOST" "$CDN_HOST")

hr() { printf '\n\033[1m== %s\033[0m\n' "$1"; }
ok() { printf '   \033[32mok\033[0m   %s\n' "$1"; }
bad() { printf '   \033[31mFAIL\033[0m %s\n' "$1"; }
info() { printf '        %s\n' "$1"; }

hr "checkout"
info "path:   $REPO_DIR"
info "branch: $(git -C "$REPO_DIR" rev-parse --abbrev-ref HEAD 2>/dev/null || echo '?')"
info "commit: $(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo '?')"
info "descr:  $(git -C "$REPO_DIR" describe --tags --always --dirty 2>/dev/null || echo '?')"
if [ -n "$(git -C "$REPO_DIR" status --porcelain 2>/dev/null)" ]; then
  bad "working tree is dirty — someone edited files on the box"
  git -C "$REPO_DIR" status --short | sed 's/^/        /'
else
  ok "working tree clean"
fi

hr "environment"
if [ -f .env.production ]; then
  ok ".env.production present"
  # Names only. Never print values from this file.
  for v in POSTGRES_PASSWORD JWT_ACCESS_SECRET JWT_REFRESH_SECRET POS_CREDENTIALS_KEY \
           KDS_PIN_SECRET BACKUP_ENCRYPTION_KEY SENTRY_DSN GOOGLE_OAUTH_CLIENT_IDS \
           APPLE_OAUTH_CLIENT_IDS SUPER_ADMIN_EMAIL ADMIN_APP_URL SMTP_HOST; do
    val="$(grep -E "^${v}=" .env.production 2>/dev/null | head -1 | cut -d= -f2-)"
    if [ -z "$val" ] || [ "$val" = "CHANGE_ME" ]; then
      bad "$v is empty or still CHANGE_ME"
      if [ "$v" = "KDS_PIN_SECRET" ]; then
        info "kitchen PIN sign-in and PIN setup are OFF (API answers 503 KDS_PIN_NOT_CONFIGURED)"
        info "fix: openssl rand -hex 32 -> KDS_PIN_SECRET in .env.production, redeploy, re-issue PINs on the Staff page"
      fi
      if [ "$v" = "ADMIN_APP_URL" ] || [ "$v" = "SMTP_HOST" ]; then
        info "forgot password answers 503 PASSWORD_RESET_UNAVAILABLE and staff invites are not emailed"
        info "fix: ADMIN_APP_URL=https://admin.takeaway.md; SMTP_HOST/PORT/USER/PASS/FROM of a provider on port 587"
      fi
    else
      ok "$v is set (${#val} chars)"
    fi
  done
  if grep -qU $'\r' .env.production 2>/dev/null; then
    bad ".env.production has CRLF line endings — values will carry a trailing \\r"
    info "fix: sed -i 's/\\r\$//' .env.production && bash deploy/scripts/deploy.sh"
  fi
else
  bad ".env.production is MISSING — the API cannot start"
fi

hr "containers"
docker ps --filter status=running --format '   {{.Names}}\t{{.Status}}\t{{.Image}}' 2>/dev/null \
  | column -t -s "$(printf '\t')" || bad "docker ps failed — is the user in the docker group?"
for c in takeaway-api-1 takeaway-nginx-1 takeaway-postgres-1 takeaway-redis-1; do
  state="$(docker inspect -f '{{.State.Status}}' "$c" 2>/dev/null || echo missing)"
  [ "$state" = "running" ] && ok "$c $state" || bad "$c $state"
done

hr "edge nginx (neighbouring project — we only ever reload it)"
if edge="$(bash "$DEPLOY_DIR/scripts/edge-nginx.sh" find 2>/dev/null)"; then
  ok "found: $edge"
  if docker exec "$edge" nginx -t >/dev/null 2>&1; then
    ok "$edge config valid"
  else
    bad "$edge config invalid — that is the neighbour's tree, not ours"
  fi
else
  bad "no edge nginx container found — a 502 on every domain would look like this"
fi

hr "api, from inside the host (bypasses DNS and Cloudflare)"
health="$(curl -sS --max-time 10 --resolve "$API_HOST:443:127.0.0.1" \
            "https://$API_HOST/api/health" 2>/dev/null || true)"
if [ -n "$health" ]; then
  ok "/api/health answered"
  info "$health"
  served="$(printf '%s' "$health" | sed -n 's/.*"commit":"\([0-9a-f]\{7,40\}\)".*/\1/p')"
  head_sha="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo '')"
  # A short commit in the public answer: match it as a prefix of HEAD.
  if [ -n "$served" ] && [ -n "$head_sha" ] && [ "${head_sha#"$served"}" != "$head_sha" ]; then
    ok "serving the checked-out commit"
  else
    bad "serving $served but the checkout is at $head_sha — the container did not restart"
  fi
else
  bad "/api/health did not answer from inside the host"
fi

code="$(curl -sS -o /tmp/ta-ready.json -w '%{http_code}' --max-time 10 \
          --resolve "$API_HOST:443:127.0.0.1" \
          "https://$API_HOST/api/health/ready" 2>/dev/null || echo 000)"
[ "$code" = "200" ] && ok "/api/health/ready 200" || bad "/api/health/ready $code"
[ -s /tmp/ta-ready.json ] && sed 's/^/        /' /tmp/ta-ready.json && echo

hr "spa domains, from inside the host"
for d in "${DOMAINS[@]}"; do
  [ "$d" = "$API_HOST" ] && continue
  c="$(curl -sS -o /dev/null -w '%{http_code}' --max-time 10 \
        --resolve "$d:443:127.0.0.1" "https://$d/" 2>/dev/null || echo 000)"
  case "$c" in
    200|301|302) ok "$d $c" ;;
    502) bad "$d 502 — the edge is holding a stale upstream; reload it" ;;
    *) bad "$d $c" ;;
  esac
done

hr "disk (shared host — a full disk has taken prod down before)"
df -h / | sed 's/^/   /'
docker system df 2>/dev/null | sed 's/^/   /' || true

hr "recent api logs"
docker logs --tail 30 takeaway-api-1 2>&1 | sed 's/^/   /' || bad "no api logs"

printf '\n'
