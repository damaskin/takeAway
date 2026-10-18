#!/usr/bin/env bash
# One-time: lays out /opt/takeaway-staging next to production and writes its
# deploy/.env.production — the staging identity (scripts/lib/env.sh), secrets
# of its own, production's harmless tunables, and everything that reaches the
# outside world switched off or pointed at test accounts. docs/environments.md.
#
# Run as root on the server; prints no secret values. It is not in a checkout
# yet when it runs, so it is piped in:
#
#   scp <telegram-env-file> hetzner:/root/staging-tg.env
#   ssh hetzner 'bash -s -- main /root/staging-tg.env' < deploy/scripts/staging-bootstrap.sh
#
# <telegram-env-file> holds TELEGRAM_BOT_USERNAME and TELEGRAM_BOT_TOKEN of the
# staging bot (@takeaway_test_bot) — never production's. An existing
# .env.production is left alone; delete it to write a fresh one.
set -euo pipefail

BRANCH="$1"
TG_ENV="$2"
ROOT=/opt/takeaway-staging
PROD=/opt/takeaway
ENV_OUT="$ROOT/repo/deploy/.env.production"

install -d -o deploy -g deploy "$ROOT" "$ROOT/www" "$ROOT/letsencrypt"
install -d -o deploy -g deploy -m 751 "$ROOT/secrets"

if [ ! -d "$ROOT/repo/.git" ]; then
  sudo -u deploy git clone -q "$(git -C "$PROD/repo" remote get-url origin)" "$ROOT/repo"
fi
sudo -u deploy git -C "$ROOT/repo" fetch -q --prune --tags --force origin
sudo -u deploy git -C "$ROOT/repo" checkout -q -f --detach "origin/$BRANCH"
echo "checkout: $(git -C "$ROOT/repo" log --oneline -1)"

install -o deploy -g deploy -m 644 "$PROD/repo/deploy/docker-compose.shared-edge.override.yml" \
  "$ROOT/repo/deploy/docker-compose.shared-edge.override.yml"

if [ -f "$ENV_OUT" ]; then
  echo "$ENV_OUT exists — leaving it alone"
  exit 0
fi

prod() { grep -E "^$1=" "$PROD/repo/deploy/.env.production" | head -1 | cut -d= -f2- || true; }
rnd() { openssl rand -hex 32; }

# VAPID keys of its own: browser push subscriptions belong to one origin and
# one key pair, and staging must never be able to push to production's.
vapid="$(docker run --rm --entrypoint node takeaway/api:local -e '
  const { generateKeyPairSync } = require("crypto");
  const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  const pub = publicKey.export({ format: "jwk" }), priv = privateKey.export({ format: "jwk" });
  const raw = Buffer.concat([Buffer.from([4]), Buffer.from(pub.x, "base64url"), Buffer.from(pub.y, "base64url")]);
  console.log(raw.toString("base64url") + " " + priv.d);')"

umask 077
cat > "$ENV_OUT" <<EOF
# takeAway STAGING — test.takeaway.md. Written $(date -u +%F) by the staging bootstrap.
# docs/environments.md. Secrets here are staging's own; nothing in this file
# may be production's except where noted.

# --- which copy of the stack this is (deploy/scripts/lib/env.sh) -------------
TAKEAWAY_ROOT=$ROOT
COMPOSE_PROJECT_NAME=takeaway-staging
IMAGE_TAG=staging
APP_ENVIRONMENT=staging
# The edge serves every takeaway.md ACME challenge from production's webroot.
CERTBOT_WEBROOT=$PROD/certbot-webroot
DOMAIN_WEB=test.takeaway.md
DOMAIN_API=test-api.takeaway.md
DOMAIN_ADMIN=test-admin.takeaway.md
DOMAIN_KDS=test-kds.takeaway.md
DOMAIN_TMA=test-tma.takeaway.md
DOMAIN_CDN=test-cdn.takeaway.md
TLS_CERT_NAME=test.takeaway.md

# --- database / cache / storage ----------------------------------------------
POSTGRES_USER=$(prod POSTGRES_USER)
POSTGRES_PASSWORD=$(rnd)
POSTGRES_DB=$(prod POSTGRES_DB)
S3_ENDPOINT=$(prod S3_ENDPOINT)
S3_REGION=$(prod S3_REGION)
S3_ACCESS_KEY=takeaway-staging
S3_SECRET_KEY=$(rnd)
S3_BUCKET=$(prod S3_BUCKET)
S3_PUBLIC_URL_BASE=https://test-cdn.takeaway.md/$(prod S3_BUCKET)
MINIO_BROWSER_REDIRECT_URL=https://test-cdn.takeaway.md

# --- secrets of its own --------------------------------------------------------
JWT_ACCESS_SECRET=$(rnd)
JWT_REFRESH_SECRET=$(rnd)
# A different key: Poster credentials copied from production stay unreadable here.
POS_CREDENTIALS_KEY=$(rnd)
HEALTH_TOKEN=$(rnd)
# Production's, on purpose: kitchen PINs copied with the data keep working.
# Production gets a fresh one when its business data is cleared.
KDS_PIN_SECRET=$(prod KDS_PIN_SECRET)
VAPID_PUBLIC_KEY=${vapid%% *}
VAPID_PRIVATE_KEY=${vapid##* }
VAPID_SUBJECT=$(prod VAPID_SUBJECT)

# --- app -----------------------------------------------------------------------
NODE_ENV=production
LOG_LEVEL=$(prod LOG_LEVEL)
API_GLOBAL_PREFIX=$(prod API_GLOBAL_PREFIX)
SENTRY_ENVIRONMENT=staging
DELIVERY_ENABLED=$(prod DELIVERY_ENABLED)
SUPPORT_EMAIL=$(prod SUPPORT_EMAIL)
CORS_ALLOWED_ORIGINS=https://test.takeaway.md,https://test-admin.takeaway.md,https://test-kds.takeaway.md,https://test-tma.takeaway.md
ADMIN_APP_URL=https://test-admin.takeaway.md
PUBLIC_WEB_URL=https://test.takeaway.md
PUBLIC_TMA_URL=https://test-tma.takeaway.md

# --- Telegram: the test bot, never production's ------------------------------
$(grep -E '^TELEGRAM_BOT_(USERNAME|TOKEN)=' "$TG_ENV")
TELEGRAM_LOGIN_CLIENT_ID=$(grep -E '^TELEGRAM_BOT_TOKEN=' "$TG_ENV" | cut -d= -f2 | cut -d: -f1)

# --- card payments: a fake bank, never the live merchant ---------------------
# docker-compose.staging.yml runs the sandbox bank beside the api and points
# every AGROPROMBANK_* setting at it, over the two lines after it. Without that
# line card payments are off. Test cards and the SMS code: docs/environments.md.
# It also reads CARD_PAYMENT_FLOW=token|web (default token, as production) and
# AGROPROMBANK_HOLD_UNTIL_ACCEPTED=true|false (default false, as production).
EXTRA_COMPOSE_FILES=docker-compose.staging.yml
AGROPROMBANK_ENABLED=false
AGROPROMBANK_WEB_ENABLED=false

# --- off on staging until set up for it --------------------------------------
# Google / Apple sign-in need test-* origins registered with Google and Apple.
GOOGLE_OAUTH_CLIENT_IDS=
GOOGLE_OAUTH_WEB_CLIENT_ID=
APPLE_OAUTH_CLIENT_IDS=
# Push to phones: no staging app build yet.
FIREBASE_PROJECT_ID=
APNS_ENABLED=false
SMTP_HOST=
STRIPE_SECRET_KEY=
SUPER_ADMIN_EMAIL=
SUPER_ADMIN_PASSWORD=
EOF
chown deploy:deploy "$ENV_OUT"
chmod 600 "$ENV_OUT"
echo "wrote $ENV_OUT ($(grep -c '=' "$ENV_OUT") settings)"
grep -E '^[A-Z_]+=$' "$ENV_OUT" | cut -d= -f1 | tr '\n' ' '; echo "<- empty"
