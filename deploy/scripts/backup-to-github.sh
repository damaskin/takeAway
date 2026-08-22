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

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_DIR=/opt/takeaway/backups
GIT_DIR=/opt/takeaway/backup-repo

if [ -z "${BACKUP_ENCRYPTION_KEY:-}" ]; then
  echo "BACKUP_ENCRYPTION_KEY is not set — refusing to write an unencrypted customer database." >&2
  echo "Generate one with: openssl rand -base64 48" >&2
  exit 1
fi

cd "$DEPLOY_DIR"

TS=$(date +%F)
LOCAL_FILE="$LOCAL_DIR/pg-${TS}.sql.gz.enc"

# 1. Dump, compress and encrypt in one pipe — the plaintext never touches
#    the disk, not even briefly.
mkdir -p "$LOCAL_DIR"
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-takeaway}" "${POSTGRES_DB:-takeaway}" \
  | gzip \
  | openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt -pass env:BACKUP_ENCRYPTION_KEY \
  > "$LOCAL_FILE"

# A truncated backup is worse than none, because it looks like one.
if [ ! -s "$LOCAL_FILE" ]; then
  echo "Backup for ${TS} is empty — aborting before it reaches the mirror." >&2
  rm -f "$LOCAL_FILE"
  exit 1
fi

# 2. Prune the local working set beyond 14 days.
find "$LOCAL_DIR" -name "pg-*.sql.gz*" -mtime +14 -delete

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
