#!/usr/bin/env bash
# An encrypted snapshot of this copy's database, taken before a risky change:
# a release whose migration reshapes data, a hand-made UPDATE on production,
# anything you might want to undo. Run on the server as root (the backups
# directory is root's), from that environment's checkout:
#
#   bash /opt/takeaway/repo/deploy/scripts/snapshot-db.sh deploy-v2026.10.20
#
# Writes <root>/backups/pre-<label>-<UTC time>.sql.gz.enc, readable by its
# owner only, and expires these snapshots after 30 days. Use this, not a bare
# pg_dump: a plaintext dump in backups/ never expires and stays readable
# after BACKUP_ENCRYPTION_KEY is destroyed (lib/backup.sh). Restore: the
# command in lib/backup.sh.

set -euo pipefail

# shellcheck source=lib/env.sh
. "$(dirname "$0")/lib/env.sh"
takeaway_require_server_layout
# shellcheck source=lib/backup.sh
. "$(dirname "$0")/lib/backup.sh"

label="${1:-}"
case "$label" in
  '' | *[!A-Za-z0-9._-]*)
    echo "usage: snapshot-db.sh <label>   — letters, digits, '.', '_', '-'; e.g. deploy-v2026.10.20" >&2
    exit 2
    ;;
esac
takeaway_require_backup_key

out="$TAKEAWAY_BACKUP_DIR/pre-$label-$(date -u +%Y%m%dT%H%M%SZ).sql.gz.enc"
takeaway_dump_encrypted "$out"
takeaway_prune_backups
ls -la "$out"
