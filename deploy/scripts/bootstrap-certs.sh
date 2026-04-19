#!/usr/bin/env bash
# Creates a throwaway self-signed certificate at the path nginx's vhosts
# reference, so nginx can start before certbot has ever run. Once certbot
# issues a real cert, certbot overwrites these files atomically — nothing
# here needs to be cleaned up later.

set -euo pipefail

CERT_DIR=/opt/takeaway/letsencrypt/live/takeaway.million-sales.ru

if [ -f "$CERT_DIR/fullchain.pem" ] && [ -f "$CERT_DIR/privkey.pem" ]; then
  echo "cert already present at $CERT_DIR — skipping bootstrap"
  exit 0
fi

mkdir -p "$CERT_DIR"

openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
  -keyout "$CERT_DIR/privkey.pem" \
  -out "$CERT_DIR/fullchain.pem" \
  -subj "/CN=bootstrap.takeaway.million-sales.ru" \
  >/dev/null 2>&1

chmod 600 "$CERT_DIR/privkey.pem"
echo "bootstrap self-signed cert written at $CERT_DIR (valid 24h; will be replaced by certbot)"
