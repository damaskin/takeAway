#!/usr/bin/env bash
#
# Builds «takeAway Test» for Android — flavor staging, md.takeaway.app.staging,
# against test.takeaway.md — and hands it to the testers through Firebase App
# Distribution. Runs where the upload key is (the owner's PC), from any
# directory:
#
#   bash apps/mobile/scripts/android-test-app.sh              # build → distribute
#   bash apps/mobile/scripts/android-test-app.sh build        # the APK only
#   NOTES="Новая корзина" bash apps/mobile/scripts/android-test-app.sh
#
# Testers get an e-mail from Firebase with the install link, once: after
# that, every new build shows up in the Firebase App Tester app. They are the
# group TESTER_GROUP of the Firebase project (Console → App Distribution →
# Testers & Groups, or `firebase appdistribution:testers:add --group-alias`).
#
# Signed with the upload key from android/key.properties, never the debug
# key: @takeaway_test_bot's Native Login entry for the app is registered
# with that key's SHA-256, and Telegram's App Link opens only an app signed
# with it (README → "Test app").
#
#   FIREBASE_TEST_APP_ID  default: the Firebase Android app of
#                         md.takeaway.app.staging in takeaway-md
#   TESTER_GROUP          default takeaway-team («takeAway team»)
#   BUILD_NUMBER          default: the pubspec's; App Distribution doesn't care
#   NOTES                 release notes; default: the commit it was built from
set -euo pipefail

cd "$(dirname "$0")/.."

FIREBASE_PROJECT=takeaway-md
FIREBASE_TEST_APP_ID="${FIREBASE_TEST_APP_ID:-1:78542530066:android:e0c6c0d8e42f47a5ae5acb}"
TESTER_GROUP="${TESTER_GROUP:-takeaway-team}"
APK=build/app/outputs/flutter-apk/app-staging-release.apk

[ -f android/key.properties ] || {
  echo "no android/key.properties: the test app must be signed with the upload key" >&2
  exit 1
}

steps=("$@")
[ ${#steps[@]} -eq 0 ] && steps=(build distribute)

for step in "${steps[@]}"; do
  case "$step" in
    build)
      echo "== flutter build apk --flavor staging"
      args=(build apk --release --flavor staging --dart-define-from-file=config/staging.json)
      [ -n "${BUILD_NUMBER:-}" ] && args+=("--build-number=$BUILD_NUMBER")
      flutter "${args[@]}"
      ;;
    distribute)
      [ -f "$APK" ] || { echo "no $APK — run the build step first" >&2; exit 1; }
      notes="${NOTES:-$(git log -1 --format='%h %s')}"
      echo "== firebase appdistribution:distribute → $TESTER_GROUP"
      firebase appdistribution:distribute "$APK" --project "$FIREBASE_PROJECT" --app "$FIREBASE_TEST_APP_ID" \
        --groups "$TESTER_GROUP" --release-notes "$notes"
      ;;
    *)
      echo "unknown step $step (build, distribute)" >&2
      exit 1
      ;;
  esac
done
