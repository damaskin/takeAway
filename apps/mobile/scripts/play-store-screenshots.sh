#!/usr/bin/env bash
#
# Google Play screenshots on a running Android emulator, from the live API, as
# a guest. The same walk as scripts/app-store-screenshots.sh:
#
#   emulator -avd Pixel_9_Pro &                                  # boot one first
#   bash apps/mobile/scripts/play-store-screenshots.sh
#   python apps/mobile/scripts/play-store-compose.py             # captioned 1080x1920
#
# integration_test/app_store_screenshots_test.dart drops shot_<name>.ready into
# the app's code_cache (Directory.systemTemp on Android) at each stop; the
# watcher below answers with `adb exec-out screencap` and shot_<name>.done. The
# app runs in Russian, location is granted up front and the status bar is put
# into demo mode (09:41, full battery).
#
# Works from git-bash on Windows: MSYS_NO_PATHCONV stops it from rewriting
# /sdcard/... into a Windows path on the way to adb.
set -uo pipefail
export MSYS_NO_PATHCONV=1

cd "$(dirname "$0")/.."

SDK="${ANDROID_HOME:-${ANDROID_SDK_ROOT:-$HOME/AppData/Local/Android/Sdk}}"
ADB="${ADB:-$SDK/platform-tools/adb}"
[ -x "$ADB" ] || ADB="$ADB.exe"
DEVICE="${DEVICE:-emulator-5554}"
CONFIG="${CONFIG:-config/prod.json}"
OUT="${OUT:-$PWD/build/play-store-screenshots}"
PKG="md.takeaway.app"
# Tiraspol, so the store list measures distances from somewhere real.
GEO="${GEO:-29.6433 46.8403}"

adb() { "$ADB" -s "$DEVICE" "$@"; }

mkdir -p "$OUT"; rm -f "$OUT"/*.png

adb wait-for-device
until [ "$(adb shell getprop sys.boot_completed | tr -d '\r')" = "1" ]; do sleep 2; done
echo "== $DEVICE booted"
adb emu geo fix $GEO >/dev/null

# Google Play services covers the app with a "Location Accuracy" dialog until
# Location Accuracy is on. It is a device setting, so switch it on once here.
adb shell am start -a com.google.android.gms.location.settings.LOCATION_ACCURACY >/dev/null 2>&1
sleep 3
adb shell uiautomator dump /sdcard/ui.xml >/dev/null 2>&1
switch=$(adb shell cat /sdcard/ui.xml 2>/dev/null | grep -o '<node [^>]*checkable="true"[^>]*>' | head -1)
if [ -n "$switch" ] && ! printf '%s' "$switch" | grep -q 'checked="true"'; then
  set -- $(printf '%s' "$switch" | grep -o 'bounds="[^"]*"' | grep -o '[0-9]\+' | xargs)
  adb shell input tap $(( ($1 + $3) / 2 )) $(( ($2 + $4) / 2 ))
  echo "== Location Accuracy switched on"
  sleep 2
fi
adb shell input keyevent KEYCODE_HOME

adb shell settings put global sysui_demo_allowed 1
demo() { adb shell am broadcast -a com.android.systemui.demo -e command "$@" >/dev/null; }
demo enter
demo clock -e hhmm 0941
demo battery -e level 100 -e plugged false
demo network -e wifi show -e level 4
demo network -e mobile hide
demo network -e sims 0
demo notifications -e visible false
# GMS notification icons stay in the status bar even in demo mode;
# play-store-compose.py crops the status bar off.

# Install first so the locale and permissions can be set for the package.
if ! adb shell pm list packages | grep -q "package:$PKG"; then
  echo "== first install"
  flutter build apk --debug --dart-define-from-file="$CONFIG" >/dev/null
  adb install -r build/app/outputs/flutter-apk/app-debug.apk >/dev/null
fi
adb shell cmd locale set-app-locales "$PKG" --locales ru-RU
for p in ACCESS_FINE_LOCATION ACCESS_COARSE_LOCATION POST_NOTIFICATIONS; do
  adb shell pm grant "$PKG" "android.permission.$p" 2>/dev/null
done

(
  while :; do
    for f in $(adb shell run-as "$PKG" ls code_cache 2>/dev/null | tr -d '\r' | grep -E '^shot_.*\.ready$'); do
      name="${f#shot_}"; name="${name%.ready}"
      adb shell run-as "$PKG" rm -f "code_cache/$f"
      adb exec-out screencap -p > "$OUT/$name.png"
      adb shell run-as "$PKG" touch "code_cache/shot_$name.done"
      echo "   shot $name"
    done
    sleep 0.5
  done
) &
watcher=$!
trap 'kill $watcher 2>/dev/null || true' EXIT

echo "== screenshots"
flutter test integration_test/app_store_screenshots_test.dart -d "$DEVICE" --dart-define-from-file="$CONFIG"
echo "== saved to $OUT"; ls -1 "$OUT"
