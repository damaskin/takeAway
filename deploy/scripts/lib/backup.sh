# Encrypted database backups, for every script in deploy/scripts that writes
# one. Sourced after lib/env.sh, never run:
#   . "$(dirname "$0")/lib/backup.sh"
#
# Everything in <root>/backups holds customer data — names, emails, phone
# numbers, order history — so nothing is written there in the clear. Every
# file is encrypted with BACKUP_ENCRYPTION_KEY (deploy/.env.production), and
# destroying that key makes every copy unreadable at once: crypto-shredding,
# the way an erasure request under GDPR / UAE PDPL is honoured against
# backups nobody can edit (backup-to-github.sh explains why). A plaintext
# dump left next to them would survive that, and nothing would ever expire it.
#
#   pg-YYYY-MM-DD.sql.gz.enc          nightly, backup-to-github.sh     14 days
#   pre-<label>-<UTC time>.*.enc      before a risky change:           30 days
#                                     snapshot-db.sh, wipe-business-data.sh,
#                                     deploy.sh (pre-deploy-<version>-…,
#                                     every production release)
#
# Restore any *.sql.gz.enc (into an empty database):
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
#     -pass env:BACKUP_ENCRYPTION_KEY -in <file>.sql.gz.enc \
#     | gunzip \
#     | docker compose -f docker-compose.prod.yml exec -T postgres psql -U takeaway takeaway

TAKEAWAY_BACKUP_DIR="$TAKEAWAY_ROOT/backups"
TAKEAWAY_NIGHTLY_RETENTION_DAYS=14
TAKEAWAY_SNAPSHOT_RETENTION_DAYS=30

# Failing a backup is recoverable; writing a plaintext customer database is not.
takeaway_require_backup_key() {
  if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
    echo "BACKUP_ENCRYPTION_KEY is not set — refusing to write an unencrypted customer database." >&2
    echo "Generate one with: openssl rand -base64 48" >&2
    return 1
  fi
}

# Two users write here: root (the nightly cron) and deploy (deploy.sh, which
# CI runs as deploy, snapshots production before a release). So backups/
# belongs to deploy, mode 750 — root writes anywhere — and is created that
# way when missing. One still owned by root, as it was before 2026-10, is
# fixed once on the server rather than worked around with sudo on every run.
takeaway_require_backup_dir() {
  if [ ! -d "$TAKEAWAY_BACKUP_DIR" ]; then
    (umask 027 && mkdir -p "$TAKEAWAY_BACKUP_DIR") || return 1
  fi
  if [ ! -w "$TAKEAWAY_BACKUP_DIR" ]; then
    echo "$TAKEAWAY_BACKUP_DIR is not writable by $(id -un). Fix it once, on the server:" >&2
    echo "  sudo chown $(id -un):$(id -gn) $TAKEAWAY_BACKUP_DIR && sudo chmod 750 $TAKEAWAY_BACKUP_DIR" >&2
    return 1
  fi
}

# stdin → stdout. One cipher and key derivation for every file in backups/,
# so one restore command opens any of them.
takeaway_encrypt() {
  openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENCRYPTION_KEY
}

takeaway_decrypt() {
  openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:BACKUP_ENCRYPTION_KEY -in "$1"
}

# Dumps this copy's database as plain SQL into $1: dump, compression and
# encryption in one pipe, so the plaintext never touches the disk, and the
# file is readable by its owner only. Then reads the file back.
takeaway_dump_encrypted() {
  local out="$1"
  mkdir -p "$(dirname "$out")"
  if ! (
    set -o pipefail
    umask 077
    docker compose -f "$TAKEAWAY_DEPLOY_DIR/docker-compose.prod.yml" exec -T postgres \
      pg_dump -U "${POSTGRES_USER:-takeaway}" "${POSTGRES_DB:-takeaway}" \
      | gzip \
      | takeaway_encrypt > "$out"
  ); then
    rm -f "$out"
    echo "pg_dump failed — no backup written to $out." >&2
    return 1
  fi
  # A truncated backup is worse than none, because it looks like one. An
  # empty dump still encrypts to a non-empty file, so its size proves
  # nothing: decrypt it and look for the line pg_dump writes when it is done.
  if ! takeaway_decrypt "$out" | gunzip | tail -n 20 | grep '^-- PostgreSQL database dump complete' >/dev/null; then
    rm -f "$out"
    echo "The backup in $out does not decrypt to a complete dump — removed." >&2
    return 1
  fi
}

# Expires what the scripts wrote. Only encrypted files and the nightly names:
# anything else in backups/ was put there by hand, and whether it goes is a
# person's decision, not a pattern's.
takeaway_prune_backups() {
  [ -d "$TAKEAWAY_BACKUP_DIR" ] || return 0
  find "$TAKEAWAY_BACKUP_DIR" -maxdepth 1 -type f -name 'pg-*.sql.gz*' \
    -mtime +"$TAKEAWAY_NIGHTLY_RETENTION_DAYS" -delete
  find "$TAKEAWAY_BACKUP_DIR" -maxdepth 1 -type f -name 'pre-*.enc' \
    -mtime +"$TAKEAWAY_SNAPSHOT_RETENTION_DAYS" -delete
}
