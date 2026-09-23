#!/usr/bin/env bash
#
# Builds the iOS app and uploads it to TestFlight. Runs ON THE MAC that
# builds iOS, from any directory:
#
#   bash apps/mobile/scripts/ios-testflight.sh            # signing → archive → verify_ipa → upload
#   bash apps/mobile/scripts/ios-testflight.sh archive    # one lane (see ios/fastlane/Fastfile)
#
# Settings and secrets live on the Mac, outside the repo, in
# ~/.appstoreconnect/takeaway.env (TAKEAWAY_IOS_ENV overrides the path):
#   ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH  App Store Connect API key
#   KEYCHAIN_PASSWORD                        build keychain, made on first run
#   FLUTTER                                  flutter binary, 3.38.8 or newer
#   APPLE_TEAM_ID, BUILD_KEYCHAIN            optional, see the Fastfile
# The dart-defines come from apps/mobile/config/prod.json (not in git).
#
# An archive takes a while: over SSH, start it with nohup and follow the log,
# or a dropped session kills the build halfway.
set -euo pipefail

cd "$(dirname "$0")/../ios"

ENV_FILE="${TAKEAWAY_IOS_ENV:-$HOME/.appstoreconnect/takeaway.env}"
if [ -f "$ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a; . "$ENV_FILE"; set +a
fi
: "${ASC_KEY_ID:?no ASC_KEY_ID — see $ENV_FILE}"
: "${ASC_ISSUER_ID:?no ASC_ISSUER_ID — see $ENV_FILE}"
: "${ASC_KEY_PATH:?no ASC_KEY_PATH — see $ENV_FILE}"
: "${KEYCHAIN_PASSWORD:?no KEYCHAIN_PASSWORD — see $ENV_FILE}"

export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8
export FASTLANE_SKIP_UPDATE_CHECK=1 FASTLANE_HIDE_CHANGELOG=1 CI=1 COCOAPODS_DISABLE_STATS=true
export PATH="$HOME/.local/bin:/opt/homebrew/bin:$PATH"

lanes=("$@")
[ ${#lanes[@]} -eq 0 ] && lanes=(signing archive verify_ipa upload)

for lane in "${lanes[@]}"; do
  echo "== fastlane ios $lane =="
  fastlane ios "$lane"
done
