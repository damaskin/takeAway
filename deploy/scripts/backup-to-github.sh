#!/usr/bin/env bash
# Daily off-server backup, encrypted.
#
# Takes a fresh pg_dump, encrypts it, keeps it locally in
# /opt/takeaway/backups/ (14-day retention), and mirrors it into a private
# GitHub repo so the backup survives a full VPS loss.
#
# Why encryption is mandatory here
# --------------------------------
# The dump contains customer names, emails, phone numbers and order
# history, and git history keeps everything ever pushed — forever, on a
# third-party host, across every clone anyone has made. Deleting a file
# only trims the working tree. That directly conflicts with the right to
# erasure under GDPR and UAE PDPL.
#
# Encrypting before the dump ever leaves this box turns that into
# crypto-shredding: the remote holds ciphertext, and destroying
# BACKUP_ENCRYPTION_KEY renders every copy unreadable in one action, which
# is a recognised way to satisfy an erasure request against immutable
# backups.
#
# The script refuses to run without a key. Failing a backup is recoverable;
# silently publishing a plaintext customer database is not.
#
# Restore:
#   openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 \
#     -pass env:BACKUP_ENCRYPTION_KEY -in pg-YYYY-MM-DD.sql.gz.enc \
#     | gunzip | psql -U takeaway takeaway

set -euo pipefail

# shellcheck source=lib/env.sh
. "$(dirname "$0")/lib/env.sh"
takeaway_require_server_layout
# shellcheck source=lib/backup.sh
. "$(dirname "$0")/lib/backup.sh"
# The mirror is production's. Staging is a copy that can be re-made from
# production (docs/environments.md) and is not backed up.
if [ "$APP_ENVIRONMENT" != production ]; then
  echo "backup-to-github.sh backs up production only (this checkout is $APP_ENVIRONMENT)." >&2
  exit 1
fi
GIT_DIR="$TAKEAWAY_ROOT/backup-repo"

takeaway_require_backup_key

TS=$(date +%F)
LOCAL_FILE="$TAKEAWAY_BACKUP_DIR/pg-${TS}.sql.gz.enc"

# 1. Dump, compress and encrypt in one pipe — the plaintext never touches
#    the disk, not even briefly — then read the file back: a truncated
#    backup is worse than none, because it looks like one (lib/backup.sh).
if ! takeaway_dump_encrypted "$LOCAL_FILE"; then
  echo "Backup for ${TS} failed — nothing reaches the mirror." >&2
  exit 1
fi

# 2. Expire the local working set: nightly dumps after 14 days, snapshots
#    taken before risky changes (pre-*.enc) after 30.
takeaway_prune_backups

# 3. Mirror into the git worktree.
cp "$LOCAL_FILE" "$GIT_DIR/pg-${TS}.sql.gz.enc"

# 4. Trim the git working tree to the same 14-day window. History still
#    holds the older ciphertext — we just don't re-commit it every day.
find "$GIT_DIR" -maxdepth 1 -name "pg-*.sql.gz*" -mtime +14 -delete

# 5. Commit + push if anything actually changed.
cd "$GIT_DIR"
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  SIZE=$(du -h "pg-${TS}.sql.gz.enc" 2>/dev/null | cut -f1 || echo unknown)
  git commit -m "backup ${TS} (${SIZE}, encrypted)"
  git push origin main
  echo "pushed encrypted backup ${TS} (${SIZE})"
else
  echo "no changes to commit"
fi
