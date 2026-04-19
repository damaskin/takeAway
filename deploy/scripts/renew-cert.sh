#!/usr/bin/env bash
# Weekly cron invocation — certbot decides whether it's actually time
# to renew. Reloads nginx only if a new certificate was installed.

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DEPLOY_DIR"

output=$(docker compose -f docker-compose.prod.yml run --rm certbot renew 2>&1)
echo "$output"

if echo "$output" | grep -q "No renewals were attempted\|not yet due for renewal"; then
  echo "nothing to reload"
  exit 0
fi

docker compose -f docker-compose.prod.yml exec nginx nginx -s reload
echo "nginx reloaded with fresh certs"
