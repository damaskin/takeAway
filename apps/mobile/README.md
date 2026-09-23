# takeAway mobile

The customer app for iOS and Android: find a store, order ahead, pay, follow
the order live and pick it up. Flutter 3.38 / Dart 3.10, talking to the same
NestJS API as the web app and the Telegram Mini App.

## What is in it

- **Onboarding** — three screens, skippable, shown once.
- **Stores** — map (OpenStreetMap) and list, nearest first when location is
  allowed, "open now" filter, route to the store in Apple / Google Maps.
- **Menu** — categories with a scroll-spy bar, search, quick add for items
  without options, product screen with sizes, milks and extras, allergens and
  nutrition. Prices are always in the store's currency.
- **Cart and checkout** — ASAP or a 15-minute pickup slot (full slots are
  shown struck through), delivery where the store offers it, promo code, gift
  card, loyalty points, pay with a bound Agroprombank card or at the counter.
  Outside working hours only a scheduled pickup can be chosen.
- **Live order** — Socket.IO with polling as a fallback, ETA ring, steps,
  pickup code and QR, "I'm here", cancel, order again, receipt by email.
- **Profile** — loyalty tier and history, referrals, gift cards, payment
  cards, notification preferences, personal details, language (RU / EN).
- **Offline** — stores and menus are cached on the device, so the app opens on
  the last menu instead of an empty screen when the network is gone.
- Light and dark theme from the design tokens in `libs/ui-kit`.

## Layout

```
lib/
  app/        router (go_router, one branch per tab), shell, MaterialApp
  core/       auth session + refresh, Dio + interceptors, realtime, push,
              location, storage, formatting (money, tax, time), theme
  features/   auth, catalog, menu, product, cart, checkout, orders, stores,
              onboarding, profile — screens next to their Riverpod providers
  shared/     widgets and helpers used across features
  l10n/       app_en.arb / app_ru.arb and the generated localizations
```

The API models and the Retrofit client live in a separate pure Dart package,
[`libs/api-client-dart`](../../libs/api-client-dart). Code generation
(`build_runner`) cannot run inside the Flutter app because some plugins ship
native build hooks, so it runs there and the generated files are committed.

## Configuration

Everything environment-specific is a `--dart-define`, collected in JSON files
under `config/`:

| File                       | Committed | Use                                                           |
| -------------------------- | --------- | ------------------------------------------------------------- |
| `config/local.json`        | yes       | Android emulator against the API on this machine              |
| `config/prod.example.json` | yes       | Template for release builds                                   |
| `config/prod.json`         | no        | Copy of the template with the Google / Firebase ids filled in |

| Define                                                                                                                      | Default                                      | Meaning                                                    |
| --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------------------------------------- |
| `API_BASE_URL`                                                                                                              | `https://api.takeaway.md/api`                | REST base including `/api`                                 |
| `REALTIME_URL`                                                                                                              | origin of `API_BASE_URL`                     | Socket.IO origin (namespace `/ws`)                         |
| `WEB_ORIGIN`                                                                                                                | `https://takeaway.md`                        | Public site, for links the app shares                      |
| `TELEGRAM_REDIRECT_URI`                                                                                                     | `takeaway://tglogin`                         | Telegram Login redirect; must match @BotFather             |
| `TELEGRAM_ANDROID_APP_LINK`                                                                                                 | `https://app3004048938-login.tg.dev/tglogin` | Android: where Telegram's page returns; see below          |
| `GOOGLE_SERVER_CLIENT_ID`                                                                                                   | empty = no Google button                     | The **web** OAuth client id, the audience the API checks   |
| `GOOGLE_IOS_CLIENT_ID`                                                                                                      | empty                                        | iOS OAuth client id                                        |
| `APPLE_SIGN_IN`                                                                                                             | `false`                                      | Offer Sign in with Apple on iOS                            |
| `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_ANDROID_APP_ID`, `FIREBASE_IOS_APP_ID` | empty = push off                             | Firebase Cloud Messaging                                   |
| `DEV_SIGN_IN`                                                                                                               | `false`                                      | Debug builds only: a "Developer sign-in" button, see below |

A missing integration hides its UI instead of failing: no Google id, no
Google button; no Firebase ids, no push prompt.

## Running locally

```bash
# API, Postgres and Redis as described in the root README; the API listens on :3000
cd apps/mobile
flutter pub get
flutter run --dart-define-from-file=config/local.json
```

`10.0.2.2` is the host machine as seen from the Android emulator; on the iOS
simulator use `http://localhost:3000/api`. Plain HTTP is allowed only for the
local network (Android debug builds, `NSAllowsLocalNetworking` on iOS).

**Developer sign-in.** With `DEV_SIGN_IN=true` a debug build offers a
"Developer sign-in" that posts an unsigned Telegram payload. The API accepts
it only when `NODE_ENV` is not `production` **and** `TELEGRAM_BOT_TOKEN` is
empty, so it cannot work against a real deployment.

Against production (`https://api.takeaway.md`) the app runs without any
config: `flutter run`.

## Sign-in setup

**Telegram** (all customers today) uses Telegram Login — Telegram's OpenID
Connect flow (core.telegram.org/bots/telegram-login), implemented in
`lib/features/auth/telegram_login.dart` the way Telegram's own iOS/Android SDKs
do it: with Telegram installed the customer confirms inside the Telegram app
(one tap); otherwise Telegram's page opens in the system browser sheet. The app
exchanges the code with PKCE (no secret in the app) and posts the ID token to
`POST /auth/telegram/oidc`, which verifies it against Telegram's keys. Needed
once:

1. `TELEGRAM_BOT_TOKEN` on the API — the app reads the client id (the bot's
   numeric id) from `GET /auth/telegram/config`.
2. In the @BotFather mini app → the bot → **Login Widget** (switched to
   OpenID Connect): `takeaway://tglogin` under **Redirect URIs**, and the apps
   under **Native Login** — Android: package `md.takeaway.app` + the SHA-256
   of every key that signs a build (`./gradlew signingReport`); iOS: bundle
   `md.takeaway.app` + the Apple team id. For @takaway_tgbot the redirect URI
   and the Android debug key are registered; the release / Play App Signing
   key and the iOS app are not yet.
3. On Android, Telegram's page (no Telegram app on the device) comes back
   through the App Link BotFather gave the Android app,
   `https://app3004048938-login.tg.dev/tglogin` (`TELEGRAM_ANDROID_APP_LINK`,
   the autoVerify intent filter in `AndroidManifest.xml`). The page leaves for
   its redirect on its own once the login is confirmed in Telegram, and
   Chrome opens an app from a page only on a tap — with the custom scheme the
   customer stayed on "Continue with Telegram" for good. The App Link loads
   Telegram's "Almost done" page instead, and its **Continue** button opens the
   app. Android verifies the link against the SHA-256 fingerprints registered
   in BotFather, so a build signed with an unregistered key gets that page back
   instead of the app. The Telegram app itself and iOS keep
   `TELEGRAM_REDIRECT_URI`: they open the custom scheme directly.

"redirect_uri required" on Telegram's page means the bot does not list the
redirect URI the app sent — Telegram compares them exactly. A build made with
`config/local.json` gets its client id from the local API, so it is that API's
bot that needs `takeaway://tglogin` registered.

The customer's account is keyed on the Telegram user id, so it is the same
profile the Mini App and the website sign in to.

**Google.** Create OAuth clients in the Google Cloud project the web client
lives in: an Android client (package `md.takeaway.app`, SHA-1 of the release
and debug keys) and an iOS client (bundle `md.takeaway.app`). Then:

- `GOOGLE_SERVER_CLIENT_ID` = the existing **web** client id;
- `GOOGLE_IOS_CLIENT_ID` = the iOS client id, and its reversed form
  (`com.googleusercontent.apps.…`) in `ios/Flutter/Google.xcconfig`;
- API: `GOOGLE_OAUTH_CLIENT_IDS` must list the web **and** the iOS client ids —
  depending on the platform the token's audience is one or the other.

**Apple** (iOS only). Enable Sign in with Apple for `md.takeaway.app` in the
developer portal, add `md.takeaway.app` to the API's `APPLE_OAUTH_CLIENT_IDS`
and build with `APPLE_SIGN_IN=true`. App Review (guideline 4.8) expects it
next to third-party logins such as Telegram and Google.

## Push notifications

1. Create a Firebase project, add an Android app (`md.takeaway.app`) and an iOS
   app (`md.takeaway.app`), upload an APNs auth key to Firebase.
2. App: the five `FIREBASE_*` defines from the Firebase app settings — no
   `google-services.json` / `GoogleService-Info.plist` is needed.
3. API: a service account with the "Firebase Cloud Messaging API Admin" role →
   `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.

Tokens are registered through `POST /devices` after sign-in and removed on
sign-out; tokens Firebase reports as dead are pruned by the API.

## Building releases

**Android.** Create an upload keystore and `android/key.properties` (never
committed):

```properties
storeFile=/absolute/path/upload-keystore.jks
storePassword=...
keyAlias=upload
keyPassword=...
```

```bash
flutter build appbundle --release --dart-define-from-file=config/prod.json
```

Without `key.properties` the release build is signed with the debug key —
fine for testers, rejected by Google Play.

**iOS → TestFlight** runs on the Mac mini (`ssh macmini`), through fastlane
(`ios/fastlane/Fastfile`) and `scripts/ios-testflight.sh`. It signs with an App
Store Connect API key and a keychain of its own, because an Apple ID asks for
2FA and the login keychain is locked over SSH. Team: Ivan Damaschin
(`FGN8R2D6QW`), Bundle ID `md.takeaway.app`.

Once per team and Mac:

1. App Store Connect → Users and Access → Integrations → App Store Connect API
   → Team Keys: a key with the **Admin** role (creating the distribution
   certificate needs it). Put `AuthKey_<id>.p8` in
   `~/.appstoreconnect/private_keys/` on the Mac.
2. App Store Connect → Apps → + → New App: iOS, name takeAway, bundle ID
   `md.takeaway.app` (register it first with `fastlane ios register_bundle_id`
   if the list does not offer it), SKU `md.takeaway.app`, primary language
   Russian. Apple refuses to create the record through the API.
3. `~/.appstoreconnect/takeaway.env` on the Mac, mode 600:

   ```bash
   ASC_KEY_ID=...                 # 10 characters
   ASC_ISSUER_ID=...              # UUID above the keys list
   ASC_KEY_PATH=$HOME/.appstoreconnect/private_keys/AuthKey_<id>.p8
   KEYCHAIN_PASSWORD=...          # any; the build keychain is created with it
   FLUTTER=$HOME/sdk/flutter-3.38.8/bin/flutter
   ```

4. `apps/mobile/config/prod.json` on the Mac, a copy of `prod.example.json`.

Each release (the archive takes a while — keep it off the SSH session):

```bash
cd ~/MyWorks/takeAway && git fetch && git checkout -f -B <branch> origin/<branch>
nohup bash apps/mobile/scripts/ios-testflight.sh > /tmp/takeaway-ios.log 2>&1 &
tail -f /tmp/takeaway-ios.log
```

The lanes run `signing` (Bundle ID with Push and Sign in with Apple,
certificate, App Store profile), `archive` (the version from `pubspec.yaml`,
the build number one above the latest in TestFlight, manual signing for the
Runner target only), `verify_ipa` and `upload`. `fastlane ios builds` shows
Apple's processing; `fastlane ios beta_group` makes the internal group that
sees every build.

`Runner.entitlements` has `aps-environment = development`; the App Store
profile turns it into production when the archive is signed.

## Tests

```bash
flutter analyze
flutter test                                    # unit + widget tests against an in-memory API
(cd ../../libs/api-client-dart && dart test)    # models against recorded API responses
```

Widget tests boot the real app (router, theme, localisation) against
`test/helpers/fake_api.dart`, a stateful fake: adding to the cart changes the
checkout total, placing an order empties the cart, a declined card can be
retried without a second order.

**On a device**, against a real API with the dev seed — signs in, orders a
latte, then moves the order through the kitchen with the KDS endpoints and
checks that the app follows live:

```bash
flutter test integration_test/ordering_e2e_test.dart -d <device> \
  --dart-define=API_BASE_URL=http://10.0.2.2:3000/api --dart-define=DEV_SIGN_IN=true \
  --dart-define=E2E_STAFF_EMAIL=<store staff or admin> --dart-define=E2E_STAFF_PASSWORD=<password>
```

`E2E_STORE`, `E2E_PRODUCT` and `E2E_SIZE` pick what is ordered (defaults match
the dev seed). After hours the test takes the first free pickup slot instead
of ASAP.

## Maintenance

- **API models** — edit `libs/api-client-dart/lib/src/models/*.dart`, then
  `dart run build_runner build --delete-conflicting-outputs && dart format lib`
  in that package. CI fails if the generated code is stale.
- **Strings** — edit both ARB files in `lib/l10n`; `flutter pub get` regenerates.
- **Icons and splash** — `python tool/generate_icons.py` (Pillow) redraws the
  launcher icons, adaptive and monochrome layers, notification icon and splash
  from code.
- **Map tiles** — OpenStreetMap's public tile servers are fine for a pilot but
  not for a large audience; switch `osmTiles` in `lib/shared/widgets/store_map.dart`
  to a commercial provider before a wide launch.
