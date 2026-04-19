#!/usr/bin/env bash
# Daily off-server backup. Takes a fresh pg_dump, keeps it locally in
# /opt/takeaway/backups/ (14-day retention), and mirrors it into a
# private GitHub repo so the backup survives a full VPS loss.
#
# The git history retains everything ever pushed, so deleting a file
# locally after 14 days only trims the working tree — older dumps stay
# available via `git log --all` / `git show` if a restore from weeks
# back is ever needed.

set -euo pipefail

DEPLOY_DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOCAL_DIR=/opt/takeaway/backups
GIT_DIR=/opt/takeaway/backup-repo

cd "$DEPLOY_DIR"

TS=$(date +%F)
LOCAL_FILE="$LOCAL_DIR/pg-${TS}.sql.gz"

# 1. Dump locally (same flow the original cron used).
mkdir -p "$LOCAL_DIR"
docker compose -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U "${POSTGRES_USER:-takeaway}" "${POSTGRES_DB:-takeaway}" | gzip > "$LOCAL_FILE"

# 2. Prune local working tree beyond 14 days (git history is authoritative).
find "$LOCAL_DIR" -name "pg-*.sql.gz" -mtime +14 -delete

# 3. Mirror into the git worktree, sync names with local.
cp "$LOCAL_FILE" "$GIT_DIR/pg-${TS}.sql.gz"

# 4. Trim the git working tree to the same 14-day window (history still
#    holds the older dumps — we just don't want to re-commit them every
#    day forever).
find "$GIT_DIR" -maxdepth 1 -name "pg-*.sql.gz" -mtime +14 -delete

# 5. Commit + push if anything actually changed.
cd "$GIT_DIR"
if [ -n "$(git status --porcelain)" ]; then
  git add -A
  SIZE=$(du -h "pg-${TS}.sql.gz" 2>/dev/null | cut -f1 || echo unknown)
  git commit -m "backup ${TS} (${SIZE})"
  git push origin main
  echo "pushed backup ${TS} (${SIZE})"
else
  echo "no changes to commit"
fi
