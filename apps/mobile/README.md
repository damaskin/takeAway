# takeAway mobile

The customer app for iOS and Android: find a store, order ahead, pay, follow
the order live and pick it up. Flutter 3.38 / Dart 3.10, talking to the same
NestJS API as the web app and the Telegram Mini App.

## What is in it

- **Onboarding** — three screens, skippable, shown once.
- **Stores** — map (OpenStreetMap) and list, nearest first when location is
  allowed; "near me" with a 500 m / 1 km radius (remembered on the device),
  "coffee / food" and "open now" filters, pins that show what a store sells,
  route to the store in Apple / Google Maps.
- **Menu** — categories with a scroll-spy bar, search, quick add for items
  without options, product screen with sizes, milks and the like as chips
  with their prices, add-ons by group opening in place, allergens and
  nutrition, and something to eat suggested under a drink. Products with a
  photo fill each category's grid; those without are listed under it as text
  rows (no stand-in pictures anywhere — App Review reads them as placeholder
  content). Prices are always in the store's currency.
- **Cart and checkout** — something to eat offered next to a drink, ASAP or a
  15-minute pickup slot (full slots are
  shown struck through), delivery where the store offers it, promo code, gift
  card, loyalty points, pay with a bound Agroprombank card or at the counter.
  Outside working hours only a scheduled pickup can be chosen.
- **Live order** — Socket.IO with polling as a fallback, ETA ring (to the
  kitchen's new estimate when it took the order late), steps, the pickup code
  the counter hands the order over by, "I'm here", cancel until the kitchen
  accepts (then a call to the store), order again, receipt by email.
- **Notifications («Уведомления»)** — brand campaigns and takeAway's own
  announcements, behind a bell with the unread count on the stores and menu
  headers and in the profile; a message opens the store's menu it links to,
  or the list of places for a brand with several.
- **Profile** — loyalty tier and history, referrals, gift cards, payment
  cards, notification settings, personal details, language (RU / EN).
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

Two things make a build: the **flavor** — which app it is — and the
**dart-defines** — its integrations and the backend it starts on. The backend
can then be switched on the phone, see [Stands](#stands-production-and-test-in-one-app).

| Flavor           | App                                                    | Android package           | iOS bundle id             | URL scheme     |
| ---------------- | ------------------------------------------------------ | ------------------------- | ------------------------- | -------------- |
| `prod` (default) | takeAway, the store app                                | `md.takeaway.app`         | `md.takeaway.ios`         | `takeaway`     |
| `staging`        | takeAway Test, see [Test app](#test-app-takeaway-test) | `md.takeaway.app.staging` | `md.takeaway.ios.staging` | `takeawaytest` |

`pubspec.yaml` sets `default-flavor: prod`, so `flutter run` and `flutter
build` without `--flavor` make the store app, as they always have. The flavor
lives in `android/app/build.gradle.kts` (product flavors) and in
`ios/Flutter/{Prod,Staging}.xcconfig` with the Xcode schemes `prod` /
`staging` and configurations `Debug-prod`, `Release-staging`… The app reads
it through `appFlavor` (`Env.isTestApp`, `Env.appUrlScheme`).

Everything environment-specific is a `--dart-define`, collected in JSON files
under `config/`:

| File                       | Committed | Use                                                             |
| -------------------------- | --------- | --------------------------------------------------------------- |
| `config/local.json`        | yes       | Android emulator against the API on this machine                |
| `config/staging.json`      | yes       | The test app against staging (test-api.takeaway.md), no secrets |
| `config/prod.example.json` | yes       | Template for release builds                                     |
| `config/prod.json`         | no        | Copy of the template with the Google / Firebase ids filled in   |

| Define                                                                                                                      | Default                                     | Meaning                                                                              |
| --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------------------ |
| `API_BASE_URL`                                                                                                              | `https://api.takeaway.md/api`               | REST base including `/api`: the stand a fresh install starts on, see below           |
| `REALTIME_URL`                                                                                                              | origin of `API_BASE_URL`                    | Socket.IO origin (namespace `/ws`), for the «Локальный» stand only                   |
| `WEB_ORIGIN`                                                                                                                | `https://takeaway.md`                       | Public site, for links the app shares; for the «Локальный» stand only                |
| `TELEGRAM_REDIRECT_URI`                                                                                                     | `<URL scheme>://tglogin`                    | Telegram Login redirect; must match @BotFather                                       |
| `TELEGRAM_ANDROID_APP_LINK`                                                                                                 | per flavor and build type                   | Android: where Telegram's page returns, `none` for the scheme; see below             |
| `GOOGLE_SERVER_CLIENT_ID`                                                                                                   | empty = no Google button                    | The **web** OAuth client id, the audience the API checks                             |
| `GOOGLE_IOS_CLIENT_ID`                                                                                                      | empty                                       | iOS OAuth client id                                                                  |
| `APPLE_SIGN_IN`                                                                                                             | `false`                                     | Offer Sign in with Apple on iOS                                                      |
| `FIREBASE_API_KEY`, `FIREBASE_PROJECT_ID`, `FIREBASE_MESSAGING_SENDER_ID`, `FIREBASE_ANDROID_APP_ID`, `FIREBASE_IOS_APP_ID` | empty = push off                            | Firebase Cloud Messaging                                                             |
| `MAP_TILE_URL`                                                                                                              | `https://takeaway.md/tiles/{z}/{x}/{y}.png` | Map tiles: our OpenStreetMap cache, see [docs/map-tiles.md](../../docs/map-tiles.md) |
| `MAP_TILE_FALLBACK_URL`                                                                                                     | OpenStreetMap                               | Asked when `MAP_TILE_URL` fails; `none` turns it off                                 |
| `MAP_TILE_ATTRIBUTION`                                                                                                      | `OpenStreetMap`                             | Credit line on the maps                                                              |
| `DEV_SIGN_IN`                                                                                                               | `false`                                     | Debug builds only: a "Developer sign-in" button, see below                           |

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
config: `flutter run`. Against staging: the same build, switched to «Тест»
on the phone (see [Stands](#stands-production-and-test-in-one-app)), or
started there with `--dart-define=API_BASE_URL=https://test-api.takeaway.md/api`.

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
   under **Native Login** — Android: package `md.takeaway.app` + a SHA-256
   (`./gradlew signingReport`); iOS: bundle `md.takeaway.ios` + the Apple
   team id `FGN8R2D6QW`. An Android entry takes **one** fingerprint, and
   BotFather derives the entry's App URL host from it, so every signing key
   gets its own entry and host. @takaway_tgbot has (since 2026-10-01):

   | Entry   | Key                                       | App URL host                 |
   | ------- | ----------------------------------------- | ---------------------------- |
   | Android | Play App Signing, original (`41:F8:F8:…`) | `app3387643188-login.tg.dev` |
   | Android | debug keystore (`B0:EB:0B:…`)             | `app3004048938-login.tg.dev` |
   | iOS     | `FGN8R2D6QW.md.takeaway.ios`              | `app2815347853-login.tg.dev` |

   The test app's bot, @takeaway_test_bot, has `takeawaytest://tglogin` and
   (since 2026-10-22) Android `md.takeaway.app.staging` with the upload key
   (`76:7E:37:…`) → `app314551967-login.tg.dev`; see [Test app](#test-app-takeaway-test).

   The Play entry uses the original app-signing key even though Play has since
   upgraded it to a quantum-ready one: Android checks App Links against the
   whole signing lineage, and the original key is what Play Console's Digital
   Asset Links snippet lists. Telegram publishes each entry at
   `https://<host>/.well-known/assetlinks.json`, which shows what is
   registered.

3. On Android, Telegram's page (no Telegram app on the device) comes back
   through the App Link of the build's package and signing key: the release
   host in release builds, the debug host otherwise, the test app's own host
   in its release builds and none in its debug builds (`Env.telegramAndroidAppLink`;
   `TELEGRAM_ANDROID_APP_LINK` overrides it; `build.gradle.kts` puts the same
   host into the autoVerify intent filter in `AndroidManifest.xml`). The page leaves for
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
and debug keys) and an iOS client (bundle `md.takeaway.ios`). Then:

- `GOOGLE_SERVER_CLIENT_ID` = the existing **web** client id;
- `GOOGLE_IOS_CLIENT_ID` = the iOS client id; fastlane's `archive` lane writes
  its reversed form (the URL scheme) to `ios/Flutter/GoogleLocal.xcconfig`;
- API: `GOOGLE_OAUTH_CLIENT_IDS` must list the web **and** the iOS client ids —
  depending on the platform the token's audience is one or the other.

**Apple** (iOS only). Enable Sign in with Apple for `md.takeaway.ios` in the
developer portal, add `md.takeaway.ios` to the API's `APPLE_OAUTH_CLIENT_IDS`
and build with `APPLE_SIGN_IN=true`. App Review (guideline 4.8) expects it
next to third-party logins such as Telegram and Google.

Profile → Sign-in methods links the other providers to the signed-in profile.
The whole setup, server side included, is in `docs/social-sign-in.md`.

## Push notifications

1. Create a Firebase project, add an Android app (`md.takeaway.app`) and an iOS
   app (`md.takeaway.ios`), upload an APNs auth key to Firebase.
2. App: the five `FIREBASE_*` defines from the Firebase app settings — no
   `google-services.json` / `GoogleService-Info.plist` is needed.
3. API: a service account with the "Firebase Cloud Messaging API Admin" role →
   `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY`.
4. iOS straight through Apple: an APNs auth key on the API (`APNS_KEY_ID`,
   `APNS_TEAM_ID`, `APNS_PRIVATE_KEY`, or the Sign in with Apple key
   `APPLE_*` when it has APNs enabled). The app registers its raw APNs token
   next to the FCM one — release builds as `PRODUCTION`, debug builds as
   `SANDBOX` — and the API pushes iPhones directly, using FCM only when Apple
   does not take a push. So iOS does not depend on the key uploaded to
   Firebase; keep that one right anyway for app versions before this change.

The device is registered through `POST /devices` for the signed-in user while
notifications are allowed (at launch, after sign-in, after the permission
prompt, and on return to the app when that changed) and removed on sign-out
or when notifications are turned off. Permission is offered once right after
sign-in, after the first order and from the notifications screen — never at
launch. Android posts order news to the `orders` channel (heads-up) and
campaigns to `promotions` (MainActivity.kt). Tokens Firebase or Apple report
as dead are pruned by the API.

A tap on an order push opens the order. A tap on a campaign or announcement
push (`kind` `campaign` / `announcement`, or any push with a
`notificationId`) opens that message over «Уведомления», the list alone when
the push has no `notificationId`; in the foreground the in-app notice offers
«Открыть» and the unread badges are read again.

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
# → build/app/outputs/bundle/prodRelease/app-prod-release.aab (flavor prod, the default)
```

Without `key.properties` the release build is signed with the debug key —
fine for testers, rejected by Google Play.

**Android → Google Play.** App `md.takeaway.app` in the Play Console of
developer account 5193596306797096194. Play re-signs every build with its own
key (Play App Signing), so a device sees Google's key, not the upload key:

| Key                                                | SHA-1                                                         | SHA-256                                                                                           |
| -------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Upload (`~/.takeaway/android/upload-keystore.jks`) | `BB:BA:A1:38:32:E9:81:7C:CB:5A:AC:65:01:EA:C3:57:CA:B7:82:F8` | `76:7E:37:F2:A1:04:49:0C:E4:AD:F9:9A:D7:D0:1C:14:2E:75:60:8C:BE:5E:52:F3:64:F5:8E:76:F5:47:D7:EB` |
| Play App Signing, current                          | `80:2E:C9:4F:FF:7A:54:C0:31:4B:1B:27:FE:6B:6E:F6:5B:72:2C:5E` | `11:3C:6A:21:42:79:92:76:CC:FF:C7:6B:71:6E:CD:86:93:5F:17:F0:97:CF:05:78:2F:06:97:3B:6D:69:32:D5` |
| Play App Signing, first (28.09)                    | `8C:53:FE:40:D7:72:67:17:FC:5B:65:1A:24:65:D3:BF:9C:BE:C6:4A` | `41:F8:F8:8D:B3:D4:29:FA:CB:91:58:F6:7E:9E:CA:1C:AD:80:FD:C8:CC:E9:F6:D3:86:46:78:D4:61:29:F7:4D` |

Any service that checks the signature needs the Play keys: all of them are
in the Firebase Android app (Firebase creates an Android OAuth client for
each SHA-1, which Google Sign-In needs), and the SHA-256 values are what
BotFather's Native Login needs. Play Console shows the app-signing values
under Test and release → App integrity → App signing, only as copy buttons.

Store listing texts and graphics live in `android/play/` (Russian only). A
release:

```bash
# versionCode must grow: Play keeps every one it has seen (1.1.0 was 1)
flutter build appbundle --release --build-number=<n> --dart-define-from-file=config/prod.json
bash scripts/play-store-screenshots.sh        # only when screens changed; needs a booted emulator
python scripts/play-store-compose.py
PYTHONIOENCODING=utf-8 python scripts/play-store-publish.py
```

`play-store-publish.py` writes the listing, graphics and the AAB into one edit
and commits it. By default the release is a draft: open Publishing overview
in Play Console and click "Send for review". Run it with `--status completed`
to roll out as soon as review passes. It authenticates with a service account
that is invited in Play Console, using the key in
`~/.takeaway/play/play-publisher.json`.

Review needs a Google account to sign in with. Reviewers may not create
accounts or use their own. Play Console → App content → Sign-in details holds
`takeaway.testreview@gmail.com` and English instructions. The customer
profile appears on the account's first sign-in.

**iOS → TestFlight** runs on the Mac mini (`ssh macmini`), through fastlane
(`ios/fastlane/Fastfile`) and `scripts/ios-testflight.sh`. It signs with an App
Store Connect API key and a keychain of its own, because an Apple ID asks for
2FA and the login keychain is locked over SSH. Team: Ivan Damaschin
(`FGN8R2D6QW`, Individual), Bundle ID `md.takeaway.ios` — the same team, API
key and build keychain as RunBase and Zhmyak on that Mac.

The iOS bundle id differs from the Android package (`md.takeaway.app`): the app
moved from Vladislav Socolov's team (`4VC4JRTQG9`) before its first App Store
release, App Transfer only moves released apps, and Apple never gives a bundle
id with uploaded builds to anyone else.

Set up once (done on the Mac mini; moved to the own team on 2026-09-27):

1. `~/.appstoreconnect/takeaway.env`, mode 600. It reuses the team's key and
   keychain shared by every app of the team:

   ```bash
   . "$HOME/.appstoreconnect/fgn8r2d6qw.env"   # ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH, KEYCHAIN_PASSWORD, BUILD_KEYCHAIN, APPLE_TEAM_ID
   FLUTTER=$HOME/sdk/flutter-3.38.8/bin/flutter
   ```

   For another team: an App Store Connect API key with the **Admin** role
   (Users and Access → Integrations → Team Keys; the distribution certificate
   needs it), `AuthKey_<id>.p8` in `~/.appstoreconnect/private_keys/`, and the
   four variables set directly; the keychain is created on the first run.

2. `fastlane ios register_bundle_id` registers `md.takeaway.ios` with push and
   Sign in with Apple. Only then does App Store Connect → Apps → + → New App
   offer it: iOS, SKU `md.takeaway.ios`, primary language Russian. Apple
   refuses to create the record through the API.
3. `apps/mobile/config/prod.json`, a copy of `prod.example.json`.
4. Flutter 3.38.8 in `~/sdk/flutter-3.38.8`: the Homebrew one on the Mac is
   older than the project's Dart constraint.

Each release (the archive takes a while — keep it off the SSH session):

```bash
cd ~/MyWorks/takeAway && git fetch && git checkout -f -B <branch> origin/<branch>
nohup bash apps/mobile/scripts/ios-testflight.sh > /tmp/takeaway-ios.log 2>&1 &
tail -f /tmp/takeaway-ios.log
```

The lanes run `signing` (Bundle ID with Push and Sign in with Apple,
certificate, App Store profile), `archive` (scheme `prod`, configuration
`Release-prod`; the version from `pubspec.yaml`, the build number one above
the latest in TestFlight, manual signing for the Runner target only),
`verify_ipa` and `upload`. `FLAVOR=staging` does the same for the test app
(below). `fastlane ios builds` shows
Apple's processing; `fastlane ios beta_group` makes the internal group that
sees every build.

Nobody sees a build in TestFlight until they are in a group. Internal testers
are users of the team in App Store Connect; add one with
`TESTER_EMAIL=... bash apps/mobile/scripts/ios-testflight.sh add_tester`.
Apple emails them an invitation, and the app shows up in the TestFlight app on
the iPhone. `testflight_status` lists the latest build's beta state, the groups
and their testers.

`Runner.entitlements` has `aps-environment = development`; the App Store
profile turns it into production when the archive is signed.

## Stands: production and test in one app

Since 2026-10-24 the store app itself switches between backends, as the
Zhmyak scanner does, so testing on staging needs no second app. A **long
press on the cup logo** of the sign-in sheet (guests) or of Профиль → «О
приложении» (signed in) opens the hidden «Сервер» sheet
(`lib/features/auth/stand_sheet.dart`):

| Stand       | API                                | Website                  |
| ----------- | ---------------------------------- | ------------------------ |
| «Прод»      | `https://api.takeaway.md/api`      | takeaway.md              |
| «Тест»      | `https://test-api.takeaway.md/api` | test.takeaway.md         |
| «Локальный» | the build's `API_BASE_URL`         | the build's `WEB_ORIGIN` |

«Локальный» exists only in builds with an `API_BASE_URL` of their own
(`config/local.json`); a build whose `API_BASE_URL` is production's or
staging's just starts on that stand (`Stand.buildDefault`), so the store
build starts on «Прод». The choice is kept on the phone (`app.stand`).

Picking another stand signs out (the API forgets the refresh token and this
device's push registration), drops what the phone kept of that server — the
store picked last, cached feature flags — and **starts the app over**
(`lib/app/app_root.dart`): a new provider container, so no session, socket,
cached menu or open screen of one server survives on the other. The catalog
cache is kept per stand (`catalog`, `catalog-test`). Off production every
screen has a corner ribbon «TEST» (or «LOCAL»), and the sign-in sheet and «О
приложении» name the stand under the logo.

On the test stand:

- **Telegram** signs in through @takeaway_test_bot — the API hands the app
  its client id. That bot must list `takeaway://tglogin` under Login Widget →
  Redirect URIs (the store app's scheme; the test app's
  `takeawaytest://tglogin` stays until that app is retired). It has no App
  Link for `md.takeaway.app`, so on Android Telegram's page returns through
  the scheme too (`Env.telegramAndroidAppLink` is empty off production).
- **Google and Apple** are offered only where the API says it completes them
  (`GET /auth/methods`); staging has no client ids, so only Telegram shows.
- **Push**: the device registers with staging's API, which has no push
  credentials — no pushes, order screens still update over the socket.
- **Cards**: the fake bank — any last four digits except `0000`, SMS code
  `111111` (`docs/environments.md`). Its Web-платёж (if staging is switched
  to the `web` flow) returns to `MOBILE_PAYMENT_RETURN_URL`, which for the
  store app is the default `takeaway://pay`.

App Review never sees the sheet unless it long-presses the logo; it starts
on production like every customer.

## Test app («takeAway Test»)

**Superseded by the stand switch above.** Once a store version with the
switch is out, testers use the store app and this one is retired;
the flavor and its distribution are still in the build until then.

A second app, flavor `staging`, for testing on staging's data
(test.takeaway.md, `docs/environments.md`) while production holds only real
businesses. It installs next to the store app, under its own name and an
icon with the colours swapped (cream mark on caramel), and is never listed
in a store: TestFlight internal testing on iOS, Firebase App Distribution on
Android.

|                   | iOS                                                | Android                                                                      |
| ----------------- | -------------------------------------------------- | ---------------------------------------------------------------------------- |
| Id                | `md.takeaway.ios.staging` (team `FGN8R2D6QW`)      | `md.takeaway.app.staging`                                                    |
| Store record      | App Store Connect «takeAway Test», TestFlight only | Firebase app `1:78542530066:android:e0c6c0d8e42f47a5ae5acb` in `takeaway-md` |
| Testers           | internal group «takeAway team» (all builds)        | App Distribution group `takeaway-team`                                       |
| Signed with       | the team's distribution certificate                | the upload key (`~/.takeaway/android`), never debug                          |
| Telegram redirect | `takeawaytest://tglogin`                           | `takeawaytest://tglogin`, page: `app314551967-login.tg.dev`                  |

What differs from the store app:

- **Backend** — `config/staging.json`: test-api.takeaway.md, links to
  test.takeaway.md. The Telegram client id comes from that API, so sign-in
  goes through the test bot @takeaway_test_bot by itself.
- **URL scheme** `takeawaytest`, for Telegram Login and the bank's page. With
  the same scheme as the store app, the phone could hand the test app's
  sign-in to the store app. The bank's Web-платёж returns to
  `MOBILE_PAYMENT_RETURN_URL` of the API, which on staging must be
  `takeawaytest://pay` (staging pays with bound cards — the `token` flow —
  unless switched to `web`).
- **Off**, as on staging itself: Google and Apple sign-in (no test-\* ids
  registered), push (no Firebase keys; staging has no push credentials).
- Paying by card: the fake bank — any last four digits except `0000`,
  SMS code `111111` (`docs/environments.md`).

**iOS → TestFlight**, on the Mac mini like the store app:

```bash
cd ~/MyWorks/takeAway && git fetch && git checkout -f -B main origin/main
FLAVOR=staging nohup bash apps/mobile/scripts/ios-testflight.sh > /tmp/takeaway-ios-staging.log 2>&1 &
```

`FLAVOR=staging` switches the Fastfile to the test app's bundle id, scheme
`staging`, configuration `Release-staging`, IPA `takeAway-Test.ipa` in
`build/ios-release-staging` and `config/staging.json`. The archive refuses a
defines file whose API does not match the flavor, and `store_listing`
refuses the test app outright. `beta_group`, `add_tester`, `invite_user`,
`builds` and `testflight_status` work on it the same way.

**Android → Firebase App Distribution**, on the PC with the upload key:

```bash
bash apps/mobile/scripts/android-test-app.sh            # build the APK, send it to takeaway-team
NOTES="Новая корзина" bash apps/mobile/scripts/android-test-app.sh
```

Testers get an e-mail from Firebase once; later builds show up in the
Firebase App Tester app. Add one with
`firebase appdistribution:testers:add <email> --group-alias takeaway-team --project takeaway-md`.
CI also builds the test app's APK (artifact `takeaway-test-android-apk`),
signed with the debug key: it signs in through the Telegram app, but
Telegram's page cannot hand it back.

Set up once (2026-10-22):

- done: Bundle ID `md.takeaway.ios.staging` with its App Store profile
  (`FLAVOR=staging … signing`); the Firebase Android app and the group
  (the owner and the manager); in @BotFather → @takeaway_test_bot → Login
  Widget: Redirect URI `takeawaytest://tglogin` and Native Login → Android,
  package `md.takeaway.app.staging`, SHA-256 of the upload key → App URL
  `https://app314551967-login.tg.dev`, which is `telegramTestAppReleaseHost`
  in `build.gradle.kts` and `_testAppReleaseLink` in `env.dart`;
- still to do: the App Store Connect record, by hand (Apple refuses it
  through the API): Apps → + → New App, iOS, name «takeAway Test» (any free
  name — the phone shows the bundle's), Russian, bundle id
  `md.takeaway.ios.staging`, SKU `md.takeaway.ios.staging`. Then on the Mac
  `FLAVOR=staging bash apps/mobile/scripts/ios-testflight.sh` (the first
  upload), `… beta_group`, and `TESTER_EMAIL=… … add_tester` for each tester
  — the manager's App Store Connect user first needs the new app among his
  visible apps (Users and Access).

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
- **Icons and splash** — `python tool/generate_icons.py` (Pillow, numpy) lifts
  the mark out of the logo artwork in `tool/brand/mark-source.jpg` and redraws
  the iOS icon set and launch image, the Android launcher icons (legacy,
  adaptive, monochrome), splash mark and notification icon, in the brand
  colours, and the test app's icons with the colours swapped
  (`AppIcon-staging`, `android/app/src/staging`). A new logo: replace that
  file and run it again.
- **Map tiles** — OpenStreetMap through our cache at `takeaway.md/tiles`, with
  retries, a fallback to OSM and a 30-day disk cache on the phone; see
  [docs/map-tiles.md](../../docs/map-tiles.md). A commercial source, if ever
  needed, goes behind the same URL on the server — no app release.
