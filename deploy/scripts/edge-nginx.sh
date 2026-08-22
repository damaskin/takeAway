#!/usr/bin/env bash
# Locate and reload the shared edge nginx.
#
# We do not own this container — it belongs to the neighbouring project on the
# same host, owns ports 80/443, and reaches takeAway by SNI passthrough
# (ssl_preread) to takeaway-nginx-1:443. It caches the upstream address, so a
# recreated takeaway-nginx-1 leaves every domain serving 502 until the edge
# reloads.
#
# The container's name is not something to hardcode: the neighbour's own
# runbook calls it `rayn-prod-nginx-1` (the compose-generated container name)
# while their workflow step and our handover notes both say `edge-nginx` (the
# compose service name). Hardcoding either has a failure mode where the reload
# silently does nothing and the outage looks like our bug. So: try the names we
# know, then find it.
#
# Reloading is the ONLY thing we do to it. Never `docker compose down`, never
# recreate it, never attach our containers to the neighbour's network — their
# postgres resolves on `rayn-prod_default` and Prisma dies with P1000 against
# credentials that are not ours.
#
# Usage: edge-nginx.sh find | reload | test

set -uo pipefail

KNOWN_NAMES=(edge-nginx rayn-prod-nginx-1)

edge_container() {
  local name
  for name in "${KNOWN_NAMES[@]}"; do
    if [ "$(docker inspect -f '{{.State.Running}}' "$name" 2>/dev/null || true)" = "true" ]; then
      printf '%s\n' "$name"
      return 0
    fi
  done

  # Neither known name is running. Find a running nginx that is not one of
  # ours — on this host that can only be the edge.
  docker ps --filter status=running --format '{{.Names}}\t{{.Image}}' 2>/dev/null \
    | awk -F'\t' 'tolower($2) ~ /nginx/ && $1 !~ /^takeaway/ { print $1; exit }'
}

case "${1:-reload}" in
  find)
    c="$(edge_container)"
    [ -n "$c" ] || { echo "no edge nginx container found" >&2; exit 1; }
    printf '%s\n' "$c"
    ;;

  test|reload)
    c="$(edge_container)"
    if [ -z "$c" ]; then
      echo "no edge nginx container found (tried: ${KNOWN_NAMES[*]}, then discovery)" >&2
      exit 1
    fi

    # Validate before reloading, so a broken config in the neighbour's tree
    # reports as theirs instead of surfacing as an opaque reload failure.
    if ! docker exec "$c" nginx -t >/dev/null 2>&1; then
      echo "$c: nginx -t failed — the edge config is broken, not reloading" >&2
      docker exec "$c" nginx -t >&2 2>&1 || true
      exit 1
    fi
    [ "${1:-reload}" = "test" ] && { echo "$c: config ok"; exit 0; }

    if docker exec "$c" nginx -s reload >/dev/null 2>&1; then
      echo "$c: reloaded"
    else
      echo "$c: reload failed" >&2
      exit 1
    fi
    ;;

  *)
    echo "usage: $(basename "$0") {find|test|reload}" >&2
    exit 2
    ;;
esac
