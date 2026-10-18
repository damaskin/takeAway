#!/usr/bin/env bash
# Issues (or renews) a single multi-SAN Let's Encrypt certificate that covers
# every host of this environment (scripts/lib/env.sh: production's
# takeaway.md, api.…, or staging's test.takeaway.md, test-api.…). Run this
# once DNS has propagated for all of them, then nginx is reloaded onto it.
#
# Usage: issue-cert.sh [admin-email]
#   Without an email the ACME account is registered without one, as
#   production's is; expiry warnings then go nowhere, and the weekly
#   renew-cert.sh cron is what keeps the certificate alive.

set -euo pipefail

EMAIL="${1:-}"

# shellcheck source=lib/env.sh
. "$(dirname "$0")/lib/env.sh"
takeaway_require_server_layout

mapfile -t DOMAINS < <(takeaway_all_hosts)
LE_DIR="$TAKEAWAY_ROOT/letsencrypt"
LIVE="$LE_DIR/live/$TLS_CERT_NAME"

if [ -n "$EMAIL" ]; then
  contact=(--email "$EMAIL")
else
  contact=(--register-unsafely-without-email)
fi

# certbot runs in a one-shot container that shares the ACME webroot with nginx.
# nginx must be up and serving the bootstrap config at this point so the
# HTTP-01 challenge round-trips cleanly.
cd "$TAKEAWAY_DEPLOY_DIR"
compose() { docker compose -f docker-compose.prod.yml "$@"; }

# The self-signed certificate bootstrap-certs.sh put in live/<name> has no
# renewal config. Left in place, certbot would not touch it and issue into
# live/<name>-0001 instead, which nginx does not read. Set it aside (nginx
# keeps the loaded copy until the reload below) and put it back on failure.
bootstrap_aside=""
if [ -d "$LIVE" ] && [ ! -f "$LE_DIR/renewal/$TLS_CERT_NAME.conf" ]; then
  bootstrap_aside="$LE_DIR/bootstrap-$TLS_CERT_NAME.bak-$(date +%Y%m%d%H%M%S)"
  mv "$LIVE" "$bootstrap_aside"
  echo "self-signed bootstrap moved aside to $bootstrap_aside"
fi

if ! compose run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  --agree-tos --non-interactive \
  "${contact[@]}" \
  --cert-name "$TLS_CERT_NAME" \
  $(printf -- '-d %s ' "${DOMAINS[@]}"); then
  if [ -n "$bootstrap_aside" ] && [ ! -e "$LIVE" ]; then
    mv "$bootstrap_aside" "$LIVE"
    echo "issuance failed — the bootstrap certificate is back in place" >&2
  fi
  exit 1
fi

compose exec -T nginx nginx -s reload
echo "certificate issued and loaded: $LIVE/"
