#!/usr/bin/env bash
# Issues (or renews) a single multi-SAN Let's Encrypt certificate that covers
# every takeAway subdomain. Run this once DNS has propagated for all of them.
#
# Usage: issue-cert.sh <admin-email>

set -euo pipefail

EMAIL="${1:-}"
if [ -z "$EMAIL" ]; then
  echo "usage: $0 <admin-email>" >&2
  exit 2
fi

DOMAINS=(
  takeaway.million-sales.ru
  api.takeaway.million-sales.ru
  admin.takeaway.million-sales.ru
  kds.takeaway.million-sales.ru
  tma.takeaway.million-sales.ru
)

# certbot runs in a one-shot container that shares the ACME webroot with nginx.
# nginx must be up and serving the bootstrap config at this point so the
# HTTP-01 challenge round-trips cleanly.
DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DEPLOY_DIR"

docker compose -f docker-compose.prod.yml run --rm certbot certonly \
  --webroot -w /var/www/certbot \
  --agree-tos --non-interactive \
  --email "$EMAIL" \
  --cert-name takeaway.million-sales.ru \
  $(printf -- '-d %s ' "${DOMAINS[@]}")

echo "certificate issued. files under /opt/takeaway/letsencrypt/live/takeaway.million-sales.ru/"
