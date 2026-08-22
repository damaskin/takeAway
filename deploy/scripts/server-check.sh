#!/usr/bin/env bash
# First step of any takeAway production investigation. Read-only: it inspects
# and reports, it never restarts, rebuilds or writes anything.
#
# Run on the server:  bash /opt/takeaway/repo/deploy/scripts/server-check.sh

set -uo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
REPO_DIR="$(cd "$DEPLOY_DIR/.." && pwd)"
cd "$DEPLOY_DIR"

DOMAINS=(takeaway.md api.takeaway.md admin.takeaway.md kds.takeaway.md tma.takeaway.md cdn.takeaway.md)

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
           APPLE_OAUTH_CLIENT_IDS SUPER_ADMIN_EMAIL; do
    val="$(grep -E "^${v}=" .env.production 2>/dev/null | head -1 | cut -d= -f2-)"
    if [ -z "$val" ] || [ "$val" = "CHANGE_ME" ]; then
      bad "$v is empty or still CHANGE_ME"
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
health="$(curl -sS --max-time 10 --resolve api.takeaway.md:443:127.0.0.1 \
            https://api.takeaway.md/api/health 2>/dev/null || true)"
if [ -n "$health" ]; then
  ok "/api/health answered"
  info "$health"
  served="$(printf '%s' "$health" | sed -n 's/.*"commit":"\([0-9a-f]\{7,40\}\)".*/\1/p')"
  head_sha="$(git -C "$REPO_DIR" rev-parse HEAD 2>/dev/null || echo '')"
  if [ -n "$served" ] && [ "$served" = "$head_sha" ]; then
    ok "serving the checked-out commit"
  else
    bad "serving $served but the checkout is at $head_sha — the container did not restart"
  fi
else
  bad "/api/health did not answer from inside the host"
fi

code="$(curl -sS -o /tmp/ta-ready.json -w '%{http_code}' --max-time 10 \
          --resolve api.takeaway.md:443:127.0.0.1 \
          https://api.takeaway.md/api/health/ready 2>/dev/null || echo 000)"
[ "$code" = "200" ] && ok "/api/health/ready 200" || bad "/api/health/ready $code"
[ -s /tmp/ta-ready.json ] && sed 's/^/        /' /tmp/ta-ready.json && echo

hr "spa domains, from inside the host"
for d in "${DOMAINS[@]}"; do
  [ "$d" = "api.takeaway.md" ] && continue
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
