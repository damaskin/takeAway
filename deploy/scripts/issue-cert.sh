#!/usr/bin/env bash
# Issues (or renews) a single multi-SAN Let's Encrypt certificate that covers
# every host of this environment (scripts/lib/env.sh: production's
# takeaway.md, api.…, or staging's test.takeaway.md, test-api.…). Run this
# once DNS has propagated for all of them.
#
# Usage: issue-cert.sh <admin-email>

set -euo pipefail

EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then
  echo "usage: $0 <admin-email>" >&2
  exit 2
fi

# shellcheck source=lib/env.sh
. "$(dirname "$0")/lib/env.sh"
takeaway_require_server_layout

mapfile -t DOMAINS < <(takeaway_all_hosts)

# certbot runs in a one-shot container that shares the ACME webroot with nginx.
# nginx must be up and serving the bootstrap config at this point so the
# HTTP-01 challenge round-trips cleanly.
cd "$TAKEAWAY_DEPLOY_DIR"

docker compose -f docker-compose.prod.yml run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  --agree-tos --non-interactive \
  --email "$EMAIL" \
  --cert-name "$TLS_CERT_NAME" \
  $(printf -- '-d %s ' "${DOMAINS[@]}")

echo "certificate issued. files under $TAKEAWAY_ROOT/letsencrypt/live/$TLS_CERT_NAME/"
