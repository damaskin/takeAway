#!/usr/bin/env bash
# Renders the vhosts of this environment: deploy/nginx/conf.d/<name>.conf.template
# → <name>.rendered.conf next to it, with the host names and the certificate
# lineage from deploy/.env.production (production's when unset — scripts/lib/env.sh).
#
# The rendered files are what nginx loads (`include conf.d/*.conf`) and are
# not committed (.gitignore: *.rendered.conf). They are written into the template directory itself because
# that directory is bind-mounted into the running nginx: a reload then sees
# the new files, and git never removes the directory (the templates and
# 05-tile-cache.conf live in it), which would leave the mount pointing at a
# deleted inode.
#
# Placeholders are {{NAME}} — not valid nginx, so a template that slips
# through unrendered fails `nginx -t` instead of serving the wrong host.
#
# Usage: render-nginx.sh [output-dir]   (default: deploy/nginx/conf.d)

set -euo pipefail

# shellcheck source=lib/env.sh
. "$(dirname "$0")/lib/env.sh"

SRC_DIR="$TAKEAWAY_DEPLOY_DIR/nginx/conf.d"
OUT_DIR="${1:-$SRC_DIR}"
mkdir -p "$OUT_DIR"

ALL_SERVER_NAMES="$(takeaway_all_hosts | tr '\n' ' ' | sed 's/ *$//')"

# A rendered file whose template is gone (renamed, removed) would still be
# loaded, and its server_name would clash with the new one.
for rendered in "$OUT_DIR"/*.rendered.conf; do
  [ -e "$rendered" ] || continue
  [ -f "$SRC_DIR/$(basename "$rendered" .rendered.conf).conf.template" ] || rm -f "$rendered"
done

# Rendering somewhere else (CI) makes a complete conf.d there: the files
# without host names come along as they are.
if [ "$(cd "$OUT_DIR" && pwd)" != "$SRC_DIR" ]; then
  for plain in "$SRC_DIR"/*.conf; do
    case "$plain" in *.rendered.conf) continue ;; esac
    [ -e "$plain" ] && cp "$plain" "$OUT_DIR/"
  done
fi

for template in "$SRC_DIR"/*.conf.template; do
  name="$(basename "$template" .conf.template).rendered.conf"
  tmp="$(mktemp "$OUT_DIR/.${name}.XXXXXX")"
  sed -e "s|{{ALL_SERVER_NAMES}}|$ALL_SERVER_NAMES|g" \
      -e "s|{{WEB_HOSTS}}|$WEB_HOSTS|g" \
      -e "s|{{API_HOST}}|$API_HOST|g" \
      -e "s|{{ADMIN_HOST}}|$ADMIN_HOST|g" \
      -e "s|{{KDS_HOST}}|$KDS_HOST|g" \
      -e "s|{{TMA_HOST}}|$TMA_HOST|g" \
      -e "s|{{CDN_HOST}}|$CDN_HOST|g" \
      -e "s|{{TLS_CERT_NAME}}|$TLS_CERT_NAME|g" \
      "$template" > "$tmp"
  if grep -n '{{' "$tmp" >&2; then
    rm -f "$tmp"
    echo "ERROR: $template has a placeholder this script does not know" >&2
    exit 1
  fi
  chmod 644 "$tmp"
  mv -f "$tmp" "$OUT_DIR/$name"
done

echo "nginx vhosts rendered for $APP_ENVIRONMENT: $ALL_SERVER_NAMES (cert $TLS_CERT_NAME)"
