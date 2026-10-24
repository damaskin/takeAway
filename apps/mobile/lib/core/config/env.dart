import 'package:flutter/foundation.dart';
import 'package:flutter/services.dart' show appFlavor;

import 'stand.dart';

/// Build-time configuration, plus the [Stand] the app runs against.
///
/// Integrations come from `--dart-define` / `--dart-define-from-file` (see
/// `config/*.json`), so nothing environment-specific has to be edited in
/// code. Optional ones (Google, Firebase) stay switched off until their keys
/// are supplied — the corresponding UI simply does not render. The backend
/// is the [stand]: the build names the one it starts on, a tester may switch
/// it on the phone (see [Stand]).
abstract final class Env {
  /// The backend of the running app. Set by `bootstrap()` before the
  /// provider container is made, and only then: switching stands starts
  /// the app over with a container of its own.
  static Stand stand = Stand.buildDefault;

  /// REST base, including the global `/api` prefix.
  static String get apiBaseUrl => stand.apiBaseUrl;

  /// Socket.IO origin: the API host; the gateway lives at `/socket.io`,
  /// namespace `/ws`.
  static String get realtimeUrl => stand.realtimeUrl;

  /// The public website, for links the app shares.
  static String get webOrigin => stand.webOrigin;

  /// The test app, «takeAway Test» (`--flavor staging`): a separate app
  /// that installs next to the store one. Its identity — ids, name, URL
  /// scheme, Telegram App Link — follows the flavor, which is what the
  /// native side registers; it starts on the stand its dart-defines name
  /// (config/staging.json: [Stand.test]). Superseded by the stand switch
  /// of the store app.
  static bool get isTestApp => appFlavor == 'staging';

  /// The app's own URL scheme: Telegram Login and the bank's page come back
  /// through it. Registered per flavor in Info.plist (APP_URL_SCHEME,
  /// ios/Flutter/{Prod,Staging}.xcconfig) and AndroidManifest.xml
  /// (build.gradle.kts); the test app has a scheme of its own, so a link
  /// meant for one of two apps installed side by side never opens the other.
  static String get appUrlScheme => isTestApp ? 'takeawaytest' : 'takeaway';

  /// Where Telegram Login sends the customer back from the Telegram app, and
  /// on iOS from the page too. Must be listed under the bot's Redirect URIs
  /// in @BotFather (Login Widget). The custom scheme needs nothing else.
  static const _telegramRedirectUri = String.fromEnvironment('TELEGRAM_REDIRECT_URI');
  static String get telegramRedirectUri =>
      _telegramRedirectUri.isEmpty ? '$appUrlScheme://tglogin' : _telegramRedirectUri;

  /// Where Telegram Login's page, open in a Custom Tab on Android, sends the
  /// customer back: the App Link @BotFather issued for the Android app
  /// (Login Widget → Native Login → App URL, plus `/tglogin`). Chrome only
  /// leaves a page for an app on a tap, and the page at this address has the
  /// button for it. BotFather derives the host from the package and the
  /// signing key, so release builds (signed by Play App Signing; the test
  /// app by our upload key) and debug builds (the debug keystore) have
  /// different ones; each must match the autoVerify intent filter, whose
  /// host build.gradle.kts sets per flavor and build type. Empty — no App
  /// Link registered for this build — falls back to [telegramRedirectUri],
  /// and the define overrides it all (`none` for empty).
  ///
  /// The links belong to the bot: production's @takaway_tgbot knows the
  /// store app. On the test stand the store app signs in through
  /// @takeaway_test_bot, which has no App Link for it, so it comes back
  /// through [telegramRedirectUri] (listed under that bot's Redirect URIs).
  static const _telegramAndroidAppLink = String.fromEnvironment('TELEGRAM_ANDROID_APP_LINK');
  static String get telegramAndroidAppLink {
    if (_telegramAndroidAppLink == 'none') return '';
    if (_telegramAndroidAppLink.isNotEmpty) return _telegramAndroidAppLink;
    if (isTestApp) return kReleaseMode ? _testAppReleaseLink : '';
    if (stand != Stand.prod) return '';
    return kReleaseMode ? 'https://app3387643188-login.tg.dev/tglogin' : 'https://app3004048938-login.tg.dev/tglogin';
  }

  /// The test app's App Link from @takeaway_test_bot, for its upload-key
  /// signed builds (`md.takeaway.app.staging`).
  static const _testAppReleaseLink = 'https://app314551967-login.tg.dev/tglogin';

  /// Map tiles, as a `{z}/{x}/{y}` URL template. By default our own caching
  /// proxy in front of OpenStreetMap (takeaway.md/tiles — nginx plus
  /// Cloudflare, see docs/map-tiles.md), which answers from a nearby edge
  /// instead of every phone asking OSM's servers. A keyed provider (MapTiler,
  /// Stadia…) can be swapped in at build time without a change of code.
  /// [mapTileAttribution] names whoever draws them.
  static const _mapTileUrl = String.fromEnvironment('MAP_TILE_URL');
  static const _mapTileAttribution = String.fromEnvironment('MAP_TILE_ATTRIBUTION');
  static String get mapTileUrl => _mapTileUrl.isEmpty ? 'https://takeaway.md/tiles/{z}/{x}/{y}.png' : _mapTileUrl;
  static String get mapTileAttribution => _mapTileAttribution.isEmpty ? 'OpenStreetMap' : _mapTileAttribution;

  /// Where a tile is asked for when [mapTileUrl] keeps failing: OpenStreetMap
  /// itself unless set; `none` turns the fallback off.
  static const _mapTileFallbackUrl = String.fromEnvironment('MAP_TILE_FALLBACK_URL');
  static String? get mapTileFallbackUrl => switch (_mapTileFallbackUrl) {
    '' => 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    'none' => null,
    final url => url,
  };

  /// Google Sign-In. The server client id is the *web* OAuth client — ID
  /// tokens minted for it are what `/auth/google` already accepts.
  static const googleServerClientId = String.fromEnvironment('GOOGLE_SERVER_CLIENT_ID');
  static const googleIosClientId = String.fromEnvironment('GOOGLE_IOS_CLIENT_ID');

  /// Sign in with Apple is offered on iOS only, and only when enabled here:
  /// the bundle id also has to be listed in the API's `APPLE_OAUTH_CLIENT_IDS`.
  static const appleSignInEnabled = bool.fromEnvironment('APPLE_SIGN_IN');

  /// Firebase Cloud Messaging. Push stays dormant unless all four are set.
  static const firebaseApiKey = String.fromEnvironment('FIREBASE_API_KEY');
  static const firebaseProjectId = String.fromEnvironment('FIREBASE_PROJECT_ID');
  static const firebaseSenderId = String.fromEnvironment('FIREBASE_MESSAGING_SENDER_ID');
  static const firebaseAndroidAppId = String.fromEnvironment('FIREBASE_ANDROID_APP_ID');
  static const firebaseIosAppId = String.fromEnvironment('FIREBASE_IOS_APP_ID');

  /// Local-development shortcut that signs in through the Telegram widget
  /// endpoint with an unsigned payload. The API only accepts that outside
  /// production with no bot token configured, and the app only offers it in
  /// debug builds.
  static const _devSignIn = bool.fromEnvironment('DEV_SIGN_IN');
  static bool get devSignIn => kDebugMode && _devSignIn;

  static bool get googleSignInConfigured => googleServerClientId.isNotEmpty;
}
