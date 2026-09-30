#!/usr/bin/env bash
#
# App Store screenshots on an iOS simulator, from the live API, as a guest.
# Runs ON THE MAC that builds iOS:
#
#   bash apps/mobile/scripts/app-store-screenshots.sh                    # iPhone 17 Pro Max (6.9")
#   DEVICE="iPhone 16 Pro Max" OUT=/tmp/shots bash apps/mobile/scripts/app-store-screenshots.sh
#   DEVICE="iPad Pro 13-inch (M5)" bash apps/mobile/scripts/app-store-screenshots.sh  # iPad (13")
#
# The app ships for iPhone and iPad, so App Store Connect wants both sets.
# Each run only replaces its own device's files (named <device>_<screen>.png),
# so running it for the iPhone and then the iPad leaves one folder with both;
# deliver sorts them into device classes by resolution.
#
# integration_test/app_store_screenshots_test.dart walks the screens and, at
# each stop, drops shot_<name>.ready into the app's tmp directory; the watcher
# below answers with `xcrun simctl io screenshot` (status bar included) and
# shot_<name>.done. The simulator is set to Russian, light mode and a clean
# 9:41 status bar, and location is granted up front so no system alert lands
# in a frame.
set -euo pipefail

cd "$(dirname "$0")/.."

DEVICE="${DEVICE:-iPhone 17 Pro Max}"
OUT="${OUT:-$PWD/build/app-store-screenshots}"
SLUG="$(printf '%s' "$DEVICE" | tr -c 'A-Za-z0-9' '-' | tr -s '-' | sed 's/-$//' | tr 'A-Z' 'a-z')"
FLUTTER="${FLUTTER:-$HOME/sdk/flutter-3.38.8/bin/flutter}"
CONFIG="${CONFIG:-config/prod.json}"
BUNDLE="md.takeaway.ios"
export PATH="$HOME/.local/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"
export LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8

UDID="$(xcrun simctl list devices available -j | python3 -c '
import json, sys
name = sys.argv[1]
devices = json.load(sys.stdin)["devices"]
ids = [d["udid"] for runtime, items in sorted(devices.items(), reverse=True) if "iOS" in runtime for d in items if d["name"] == name]
print(ids[0] if ids else "")
' "$DEVICE")"
[ -n "$UDID" ] || { echo "No available simulator named '$DEVICE'"; exit 1; }
echo "== $DEVICE ($UDID)"

# Language and region are read at boot: set them, then boot again.
xcrun simctl boot "$UDID" 2>/dev/null || true
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl spawn "$UDID" defaults write -g AppleLanguages -array ru
xcrun simctl spawn "$UDID" defaults write -g AppleLocale ru_MD
xcrun simctl shutdown "$UDID"
xcrun simctl boot "$UDID"
xcrun simctl bootstatus "$UDID" -b >/dev/null
xcrun simctl ui "$UDID" appearance light
xcrun simctl status_bar "$UDID" override --time 9:41 --dataNetwork wifi --wifiMode active --wifiBars 3 \
  --cellularMode active --cellularBars 4 --batteryState charged --batteryLevel 100
xcrun simctl location "$UDID" set 46.8403,29.6433 # Tiraspol

mkdir -p "$OUT"
rm -f "$OUT/${SLUG}"_*.png

run_test() {
  "$FLUTTER" test integration_test/app_store_screenshots_test.dart -d "$UDID" \
    --dart-define-from-file="$CONFIG" "$@"
}

# The app has to be installed before location can be granted to it.
if ! xcrun simctl get_app_container "$UDID" "$BUNDLE" >/dev/null 2>&1; then
  echo "== first install"
  "$FLUTTER" build ios --simulator --debug --dart-define-from-file="$CONFIG" >/dev/null
  xcrun simctl install "$UDID" build/ios/iphonesimulator/Runner.app
fi
xcrun simctl privacy "$UDID" grant location "$BUNDLE" || true

(
  while :; do
    container="$(xcrun simctl get_app_container "$UDID" "$BUNDLE" data 2>/dev/null || true)"
    if [ -n "$container" ] && [ -d "$container/tmp" ]; then
      for ready in "$container"/tmp/shot_*.ready; do
        [ -e "$ready" ] || continue
        name="$(basename "$ready" .ready)"
        name="${name#shot_}"
        rm -f "$ready"
        xcrun simctl io "$UDID" screenshot --type=png "$OUT/${SLUG}_$name.png" >/dev/null 2>&1
        touch "$container/tmp/shot_$name.done"
        echo "   shot $name"
      done
    fi
    sleep 0.3
  done
) &
watcher=$!
trap 'kill $watcher 2>/dev/null || true' EXIT

echo "== screenshots"
run_test "$@"
echo "== saved to $OUT"
ls -1 "$OUT"
