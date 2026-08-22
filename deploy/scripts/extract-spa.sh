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

  # Put the version on a window global as well, so Sentry can tag an issue
  # with the exact deploy it came from. index.html is the same runtime-config
  # channel the DSN and the OAuth client ids already use.
  if [ -n "${BUILD_VERSION:-}" ] && [ -f "$tmp/index.html" ]; then
    sed -i "s|<head>|<head><script>window.__BUILD_VERSION='${BUILD_VERSION}';</script>|" "$tmp/index.html"
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
