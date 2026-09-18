#!/usr/bin/env bash
# Build each SPA image and extract its /dist into the host webroot that
# nginx serves from. Invoked by the deploy script; safe to run on its own.
#
# Usage: extract-spa.sh [web|admin|kds|tma]...
#        (no args -> extract all four)

set -euo pipefail

APPS=("${@}")
if [ ${#APPS[@]} -eq 0 ]; then
  APPS=(web admin kds tma)
fi

WEBROOT=/opt/takeaway/www
REPO_DIR="$(cd "$(dirname "$0")/../.." && pwd)"

mkdir -p "$WEBROOT"

for app in "${APPS[@]}"; do
  image="takeaway/${app}:local"
  echo "--- building ${app} ---"
  docker build \
    -f "$REPO_DIR/deploy/Dockerfile.spa" \
    --build-arg APP_NAME="$app" \
    -t "$image" \
    "$REPO_DIR"

  echo "--- extracting ${app} ---"
  cid=$(docker create "$image")
  # Write into a temp dir first so a failed extract never half-replaces
  # the live webroot.
  tmp=$(mktemp -d "$WEBROOT/.${app}.XXXXXX")
  docker cp "${cid}:/dist/." "$tmp/"
  docker rm "$cid" >/dev/null

  # mktemp defaults to 700; nginx runs as a different uid inside its
  # container and needs read+execute on the webroot dirs, so open up.
  chmod -R a+rX "$tmp"

  # Runtime configuration for the SPA, injected into index.html.
  #
  # These are all public values — OAuth client ids, a browser Sentry DSN, a
  # bot username, the build version — but they differ per environment, and
  # baking them into the committed source would mean a code change to point
  # staging at a different Google project. index.html is the one file we can
  # rewrite after the bundle is built, so it is the config channel.
  #
  # Each line only overwrites the placeholder when the variable is set, so an
  # unset value keeps whatever the source declares (usually empty, which
  # disables that feature).
  if [ -f "$tmp/index.html" ]; then
    inject_global() {
      local name="$1" value="$2"
      [ -z "$value" ] && return 0
      # Replace the existing assignment if the source declares one, so we
      # never end up with two conflicting definitions of the same global.
      if grep -q "window.${name}" "$tmp/index.html"; then
        sed -i "s|window\.${name} *= *'[^']*';|window.${name}='${value}';|" "$tmp/index.html"
      else
        sed -i "s|<head>|<head><script>window.${name}='${value}';</script>|" "$tmp/index.html"
      fi
    }

    inject_global __BUILD_VERSION "${BUILD_VERSION:-}"
    inject_global __SENTRY_DSN "${SENTRY_DSN_WEB:-}"
    inject_global __SENTRY_ENVIRONMENT "${SENTRY_ENVIRONMENT:-production}"
    inject_global __TELEGRAM_BOT_USERNAME "${TELEGRAM_BOT_USERNAME:-}"
    inject_global __GOOGLE_CLIENT_ID "${GOOGLE_OAUTH_WEB_CLIENT_ID:-}"
    inject_global __APPLE_CLIENT_ID "${APPLE_OAUTH_SERVICES_ID:-}"
    inject_global __APPLE_REDIRECT_URI "${APPLE_OAUTH_REDIRECT_URI:-}"
  fi

  # Stamp the SPA bundle with the build version triple so every browser
  # session can fetch /version.json (and the lib-version-badge component
  # can render it). BUILD_* are exported by deploy.sh.
  if [ -n "${BUILD_VERSION:-}" ]; then
    cat > "$tmp/version.json" <<JSON
{ "version": "${BUILD_VERSION}", "commit": "${BUILD_COMMIT:-unknown}", "builtAt": "${BUILD_TIME:-unknown}", "app": "${app}" }
JSON
    chmod a+r "$tmp/version.json"
  fi

  # Atomically swap.
  if [ -d "$WEBROOT/$app" ]; then
    rm -rf "$WEBROOT/${app}.old"
    mv "$WEBROOT/$app" "$WEBROOT/${app}.old"
  fi
  mv "$tmp" "$WEBROOT/$app"
  rm -rf "$WEBROOT/${app}.old"
done

echo "done. webroot: $WEBROOT"
ls -la "$WEBROOT"
