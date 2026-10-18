#!/usr/bin/env bash
# Routes staging's host names through the shared edge to takeaway-staging-nginx-1.
# Run once on the server as root, after staging's nginx has started (the edge
# resolves upstream names when it loads its config, so `nginx -t` fails for a
# container that does not exist yet). docs/environments.md.
#
#   bash /opt/takeaway-staging/repo/deploy/scripts/edge-staging-routes.sh
#
# The edge belongs to the neighbouring rayn project (/opt/rayn-repo/infra/edge,
# see edge-nginx.sh). Production reaches us through `.takeaway.md`, which in a
# `map … hostnames` also matches test.takeaway.md — so staging's names are
# listed exactly, and exact names win over the wildcard. On :80 they join
# production's server block, whose ACME webroot staging's certbot writes to.
#
# What this does to the neighbour's file, and nothing else:
#   - six exact names in the SNI map → takeaway-staging443
#   - `upstream takeaway-staging443 { server takeaway-staging-nginx-1:443; }`
#   - the same six names on production's :80 server_name line
# The file is rewritten in place (same inode — it is bind-mounted as a single
# file, and a new inode would stay invisible to the running container), tested
# with `nginx -t` inside the edge, restored from the backup if that fails, and
# then reloaded — never restarted.
#
# The lines must also be committed in the rayn repository
# (infra/edge/nginx.conf): its deploy does `git reset --hard` there.

set -euo pipefail

CONF="${EDGE_CONF:-/opt/rayn-repo/infra/edge/nginx.conf}"
HOSTS=(test.takeaway.md test-api.takeaway.md test-admin.takeaway.md test-kds.takeaway.md test-tma.takeaway.md test-cdn.takeaway.md)
UPSTREAM_CONTAINER=takeaway-staging-nginx-1

EDGE="$(bash "$(dirname "$0")/edge-nginx.sh" find)"

if grep -q 'takeaway-staging443' "$CONF"; then
  echo "staging routes are already in $CONF"
  docker exec "$EDGE" grep -q 'takeaway-staging443' /etc/nginx/nginx.conf \
    || echo "WARNING: but the running edge does not see them — its mount points at an older inode" >&2
  exit 0
fi
if [ "$(docker inspect -f '{{.State.Running}}' "$UPSTREAM_CONTAINER" 2>/dev/null || true)" != true ]; then
  echo "$UPSTREAM_CONTAINER is not running — deploy staging first" >&2
  exit 1
fi
for anchor in '    default            rayn443;' \
              '  upstream takeaway443 { server takeaway-nginx-1:443; }' \
              '    server_name kds.takeaway.md tma.takeaway.md cdn.takeaway.md;'; do
  if [ "$(grep -cxF "$anchor" "$CONF")" != 1 ]; then
    echo "the edge config has changed shape: expected exactly one line '$anchor'" >&2
    exit 1
  fi
done

backup="$CONF.bak-takeaway-staging-$(date +%Y%m%d-%H%M%S)"
cp -p "$CONF" "$backup"

map_lines="    # takeAway staging (/opt/takeaway-staging): exact names beat .takeaway.md above."
for h in "${HOSTS[@]}"; do map_lines+=$'\n'"$(printf '    %-24s takeaway-staging443;' "$h")"; done
upstream_line="  upstream takeaway-staging443 { server $UPSTREAM_CONTAINER:443; }  # takeAway staging"
server_line="    server_name ${HOSTS[*]};  # takeAway staging"

new="$(awk -v map="$map_lines" -v up="$upstream_line" -v srv="$server_line" '
  $0 == "    default            rayn443;" { print map }
  { print }
  $0 == "  upstream takeaway443 { server takeaway-nginx-1:443; }" { print up }
  $0 == "    server_name kds.takeaway.md tma.takeaway.md cdn.takeaway.md;" { print srv }
' "$CONF")"

# In place: truncate and write, same inode.
printf '%s\n' "$new" > "$CONF"

if ! docker exec "$EDGE" nginx -t; then
  cat "$backup" > "$CONF"
  echo "nginx -t failed — the edge config is restored from $backup, nothing was reloaded" >&2
  exit 1
fi
docker exec "$EDGE" nginx -s reload
echo "edge reloaded with staging routes (backup: $backup)"
