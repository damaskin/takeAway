#!/usr/bin/env bash
# Has staging run this release? The "Staging has run it" step of
# .github/workflows/deploy.yml, kept here so it can be tested and dry-run.
# docs/environments.md.
#
#   bash deploy/scripts/release-staging-check.sh <release-commit> [<staged-commit>...]
#
# <staged-commit>… are the head commits of successful push-triggered runs of
# "Deploy to staging". A dry run against the real list, from a checkout with
# the release tag fetched:
#
#   bash deploy/scripts/release-staging-check.sh v2026.10.21 \
#     $(gh api 'repos/{owner}/{repo}/actions/workflows/deploy-staging.yml/runs?status=success&event=push&per_page=100' \
#         --jq '.workflow_runs[].head_sha')
#
# The release passes when either
#   1. a staged commit contains it (it is that commit, or an ancestor of one);
#   2. it differs from the newest staged commit it contains only in files that
#      do not trigger a staging deploy — the `paths-ignore` list of
#      deploy-staging.yml. That is a release on top of docs-only commits, such
#      as the changelog PR before every release: staging skips them, and the
#      code they would deploy is exactly the code staging already ran.
# Anything else fails with exit 1 and a ::error:: line for GitHub Actions.
#
# The list is read from deploy-staging.yml at the release commit, so there is
# one list, not two to keep in step (and a release whose diff touches that
# workflow is not docs-only anyway). GitHub's filter patterns are matched with
# git's glob pathspecs, which read `*`, `**/`, `/**` and `/**/` the same way.
# Patterns where the two differ (`!`, `?`, `+`, `**` inside a name, anything
# exotic) switch rule 2 off with a warning instead of guessing.
#
# Tests: deploy/scripts/release-staging-check.test.sh.

set -euo pipefail

STAGING_WORKFLOW="${STAGING_WORKFLOW:-.github/workflows/deploy-staging.yml}"

[ $# -ge 1 ] || {
  echo "usage: $0 <release-commit> [<staged-commit>...]" >&2
  exit 2
}
cd "$(git rev-parse --show-toplevel)"

release="$(git rev-parse --verify --quiet "$1^{commit}")" || {
  echo "::error::$1 is not a commit in this checkout."
  exit 1
}
shift

# Staged commits this checkout has (a run of a since-rewritten history may not).
staged=()
for s in "$@"; do
  c="$(git rev-parse --verify --quiet "$s^{commit}")" && staged+=("$c")
done

# Rule 1.
for s in ${staged[@]+"${staged[@]}"}; do
  if git merge-base --is-ancestor "$release" "$s"; then
    echo "staging deployed $s, which contains $release"
    exit 0
  fi
done

# The newest staged commit the release contains.
base=""
for s in ${staged[@]+"${staged[@]}"}; do
  git merge-base --is-ancestor "$s" "$release" || continue
  if [ -z "$base" ] || git merge-base --is-ancestor "$base" "$s"; then
    base="$s"
  fi
done

retry_hint='Let "Deploy to staging" finish for it (or rerun it), check test.takeaway.md, then release again.'
if [ -z "$base" ]; then
  echo "::error::No successful staging deploy contains $release yet. $retry_hint"
  exit 1
fi

# The workflow's `paths-ignore` items, one per line. Fails when the block is
# missing, appears more than once, or has a shape this does not read.
ignored_paths() {
  git show "$release:$STAGING_WORKFLOW" 2>/dev/null | awk -v q="'" '
    /^[ \t]*paths-ignore:/ {
      blocks++
      if ($0 !~ /^[ \t]*paths-ignore:[ \t]*(#.*)?$/) bad = 1  # inline [a, b]
      match($0, /^[ \t]*/); indent = RLENGTH; inside = 1; next
    }
    inside {
      if ($0 ~ /^[ \t]*(#.*)?$/) next
      match($0, /^[ \t]*/); ind = RLENGTH; item = substr($0, ind + 1)
      if (ind < indent || (ind == indent && item !~ /^-/)) { inside = 0; next }
      if (item !~ /^-[ \t]/) { bad = 1; next }
      sub(/^-[ \t]+/, "", item)
      c = substr(item, 1, 1)
      if (c == q || c == "\"") {
        item = substr(item, 2); stop = index(item, c)
        if (stop == 0) { bad = 1; next }
        item = substr(item, 1, stop - 1)
      } else {
        sub(/[ \t]+#.*$/, "", item); sub(/[ \t]+$/, "", item)
      }
      print item; items++
    }
    END { exit (blocks == 1 && items > 0 && !bad) ? 0 : 1 }
  '
}

# A GitHub filter pattern that means the same as a git glob pathspec: plain
# names, `*` within a name, `**` only as a whole path segment.
same_in_git() {
  local p="$1" seg segs
  [[ "$p" =~ ^[A-Za-z0-9._/*-]+$ ]] || return 1
  [[ "$p" != /* && "$p" != */ && "$p" != *//* ]] || return 1
  IFS=/ read -ra segs <<<"$p"
  for seg in "${segs[@]}"; do
    [[ "$seg" != . && "$seg" != .. ]] || return 1
    [[ "$seg" == '**' || "$seg" != *'**'* ]] || return 1
  done
}

# Rule 2.
if ! patterns="$(ignored_paths)"; then
  echo "::warning::Could not read paths-ignore from $STAGING_WORKFLOW at $release; only rule 1 applies."
else
  excludes=()
  unsupported=""
  while IFS= read -r p; do
    same_in_git "$p" || unsupported+=" '$p'"
    excludes+=(":(glob,exclude)$p")
  done <<<"$patterns"

  if [ -n "$unsupported" ]; then
    echo "::warning::paths-ignore in $STAGING_WORKFLOW has patterns git cannot match the way GitHub does:$unsupported; only rule 1 applies."
  else
    changed="$(git diff --no-renames --name-only "$base" "$release" -- . "${excludes[@]}")"
    if [ -z "$changed" ]; then
      echo "staging deployed $base; $release adds to it only files staging ignores (${patterns//$'\n'/ })"
      exit 0
    fi
    echo "::error::$release has not been on staging. The newest staging deploy it contains is $base, and since then it changes files staging deploys. $retry_hint"
    head -20 <<<"$changed"
    n="$(wc -l <<<"$changed")"
    [ "$n" -le 20 ] || echo "… and $((n - 20)) more"
    exit 1
  fi
fi

echo "::error::No successful staging deploy contains $release yet (the newest one it contains is $base). $retry_hint"
exit 1
