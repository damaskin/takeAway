#!/usr/bin/env bash
# Tests for release-staging-check.sh, run by CI (ci.yml) and by hand:
#
#   bash deploy/scripts/release-staging-check.test.sh
#
# Builds a throwaway git repository whose staging workflow is a copy of the
# real .github/workflows/deploy-staging.yml, so the paths-ignore list the
# check parses is the one staging actually uses.

set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
check="$here/release-staging-check.sh"
workflow="$here/../../.github/workflows/deploy-staging.yml"

repo="$(mktemp -d)"
trap 'rm -rf "$repo"' EXIT
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
export GIT_AUTHOR_NAME=test GIT_AUTHOR_EMAIL=test@example.com
export GIT_COMMITTER_NAME=test GIT_COMMITTER_EMAIL=test@example.com
cd "$repo"
git init -q -b main

# commit <message> <path>... — appends a line to each path, commits, prints the SHA.
commit() {
  local msg="$1" p
  shift
  for p in "$@"; do
    mkdir -p "$(dirname "$p")"
    echo "$msg" >>"$p"
  done
  git add -A
  git commit -qm "$msg"
  git rev-parse HEAD
}

# orphan <name> — a new history with nothing in it, for another staging workflow.
orphan() {
  git checkout -q --orphan "$1"
  git rm -rqf .
  mkdir -p .github/workflows
}

failures=0
# expect <name> pass|fail <text the output contains> <release> [<staged>...]
expect() {
  local name="$1" want="$2" text="$3" out rc
  shift 3
  out="$(bash "$check" "$@" 2>&1)" && rc=0 || rc=$?
  if { [ "$want" = pass ] && [ "$rc" -eq 0 ]; } || { [ "$want" = fail ] && [ "$rc" -eq 1 ]; }; then
    if [[ "$out" == *"$text"* ]]; then
      echo "ok    $name"
      return
    fi
  fi
  echo "FAIL  $name — wanted $want with \"$text\", got exit $rc:"
  sed 's/^/      /' <<<"$out"
  failures=$((failures + 1))
}

# main: A ─ B (staged) ─ D1 docs ─ D2 docs ─ C code (never staged) ─ D3 docs
mkdir -p .github/workflows
cp "$workflow" .github/workflows/deploy-staging.yml
A="$(commit 'A: code' apps/api/main.ts)"
B="$(commit 'B: code, deployed to staging' apps/api/main.ts)"
D1="$(commit 'D1: changelog' docs/CHANGELOG.md README.md apps/web/README.md)"
D2="$(commit 'D2: more docs' docs/guide/setup.md)"
C="$(commit 'C: code staging never ran' apps/web/app.ts)"
D3="$(commit 'D3: docs on top of C' docs/CHANGELOG.md)"

# Side branches off B, each one commit that only looks like docs.
git checkout -q -b rename "$B"
mkdir -p docs
git mv apps/api/main.ts docs/main.ts
git commit -qm 'R: code moved into docs/'
R="$(git rev-parse HEAD)"
git checkout -q -b docsx "$B"
M="$(commit 'M: docsx/ is not docs/' docsx/notes.txt)"
git checkout -q -b mdx "$B"
X="$(commit 'X: .mdx is not .md' apps/web/README.mdx)"
git checkout -q -b workflow "$B"
W="$(commit 'W: docs plus the staging workflow' docs/CHANGELOG.md .github/workflows/deploy-staging.yml)"

echo "rule 1 — staging ran it, or something built on it"
expect 'a code commit on staging' pass 'which contains' "$B" "$B"
expect 'an older commit under a staged one' pass 'which contains' "$A" "$B"

echo "rule 2 — docs-only on top of the newest staged commit"
expect 'a docs-only commit on a staged one' pass 'only files staging ignores' "$D1" "$B"
expect 'two docs-only commits' pass 'only files staging ignores' "$D2" "$B"
expect 'the newest staged commit counts, listed last' pass 'only files staging ignores' "$D2" "$A" "$B"
expect 'the newest staged commit counts, listed first' pass 'only files staging ignores' "$D2" "$B" "$A"
expect 'staged commits this checkout lacks are skipped' pass 'only files staging ignores' \
  "$D1" deadbeefdeadbeefdeadbeefdeadbeefdeadbeef "$B"

echo "not on staging"
expect 'a code commit staging never ran' fail 'apps/web/app.ts' "$C" "$B"
expect 'docs on top of a code commit staging never ran' fail 'apps/web/app.ts' "$D3" "$B"
expect 'docs on top of an older staged commit' fail 'apps/api/main.ts' "$D1" "$A"
expect 'nothing staged' fail 'No successful staging deploy' "$D1"
expect 'only unknown staged commits' fail 'No successful staging deploy' \
  "$D1" deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
expect 'staged only on another branch' fail 'No successful staging deploy' "$D1" "$R"
expect 'code moved into docs/' fail 'apps/api/main.ts' "$R" "$B"
expect 'docsx/ is not docs/' fail 'docsx/notes.txt' "$M" "$B"
expect '.mdx is not .md' fail 'apps/web/README.mdx' "$X" "$B"
expect 'a change to the staging workflow' fail '.github/workflows/deploy-staging.yml' "$W" "$B"
expect 'an unknown release' fail 'is not a commit' v1999.01.01 "$B"

echo "paths-ignore the check cannot read the way GitHub does — rule 2 off"
orphan negated
cat >.github/workflows/deploy-staging.yml <<'YAML'
on:
  push:
    paths-ignore:
      - 'docs/**'
      - '!docs/deploy.md'
YAML
N0="$(commit 'N0: code' apps/api/main.ts)"
N1="$(commit 'N1: docs' docs/notes.md)"
expect 'a negated pattern' fail 'only rule 1 applies' "$N1" "$N0"
expect 'a negated pattern, rule 1 still applies' pass 'which contains' "$N0" "$N0"

orphan inline
cat >.github/workflows/deploy-staging.yml <<'YAML'
on:
  push:
    paths-ignore: ['docs/**']
YAML
I0="$(commit 'I0: code' apps/api/main.ts)"
I1="$(commit 'I1: docs' docs/notes.md)"
expect 'an inline list' fail 'Could not read paths-ignore' "$I1" "$I0"

orphan absent
cat >.github/workflows/deploy-staging.yml <<'YAML'
on:
  push:
    branches: [main]
YAML
Z0="$(commit 'Z0: code' apps/api/main.ts)"
Z1="$(commit 'Z1: docs' docs/notes.md)"
expect 'no paths-ignore at all' fail 'Could not read paths-ignore' "$Z1" "$Z0"

echo "other YAML shapes of the list"
orphan indentless
cat >.github/workflows/deploy-staging.yml <<'YAML'
on:
  push:
    paths-ignore:
    # docs never deploy
    - docs/**   # the handbook

    - "**/*.md"
  workflow_dispatch:
    inputs: {}
YAML
P0="$(commit 'P0: code' apps/api/main.ts)"
P1="$(commit 'P1: docs' docs/notes.txt README.md)"
expect 'unquoted, indentless, with comments' pass 'only files staging ignores (docs/** **/*.md)' "$P1" "$P0"

echo
if [ "$failures" -gt 0 ]; then
  echo "$failures failed"
  exit 1
fi
echo "all passed"
