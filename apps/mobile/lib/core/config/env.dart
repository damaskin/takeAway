import 'package:flutter/foundation.dart';

/// Build-time configuration.
///
/// Everything here comes from `--dart-define` / `--dart-define-from-file`
/// (see `config/*.json`), so one binary is always bound to one backend and
/// nothing environment-specific has to be edited in code. Optional
/// integrations (Google, Firebase) stay switched off until their keys are
/// supplied — the corresponding UI simply does not render.
abstract final class Env {
  /// REST base, including the global `/api` prefix.
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'https://api.takeaway.md/api');

  /// Socket.IO origin. Defaults to the origin of [apiBaseUrl]; the gateway
  /// lives at `/socket.io` on the API host, namespace `/ws`.
  static const _realtimeUrl = String.fromEnvironment('REALTIME_URL');

  /// Site that hosts the Telegram sign-in bridge page. It must be the domain
  /// registered for the bot with @BotFather `/setdomain`.
  static const webOrigin = String.fromEnvironment('WEB_ORIGIN', defaultValue: 'https://takeaway.md');

  /// Custom URL scheme the Telegram bridge page redirects back to.
  static const callbackScheme = 'takeaway';

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

  static String get realtimeUrl {
    if (_realtimeUrl.isNotEmpty) return _realtimeUrl;
    final api = Uri.parse(apiBaseUrl);
    return api.replace(path: '').toString().replaceAll(RegExp(r'[/?#]+$'), '');
  }

  static bool get googleSignInConfigured => googleServerClientId.isNotEmpty;
}
