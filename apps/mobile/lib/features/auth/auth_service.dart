import 'dart:async';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:google_sign_in/google_sign_in.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/auth/session.dart';
import '../../core/auth/session_manager.dart';
import '../../core/config/env.dart';
import '../../core/providers.dart';
import '../../core/push/push_service.dart';
import 'telegram_login.dart';

/// Thrown when the customer backs out of a provider's own sign-in UI. Not
/// an error worth showing.
class SignInCancelled implements Exception {
  const SignInCancelled();
}

/// Public Telegram Login details; null when the API has no bot configured.
final telegramConfigProvider = FutureProvider<TelegramAuthConfig?>((ref) async {
  try {
    final config = await ref.watch(apiProvider).telegramConfig();
    return config.available ? config : null;
  } on Object {
    return null;
  }
});

/// Which sign-in buttons this build can offer.
class SignInOptions {
  const SignInOptions({required this.telegram, required this.google, required this.apple, required this.dev});

  final bool telegram;
  final bool google;
  final bool apple;
  final bool dev;

  bool get any => telegram || google || apple || dev;
}

final signInOptionsProvider = FutureProvider<SignInOptions>((ref) async {
  final telegram = await ref.watch(telegramConfigProvider.future);
  return SignInOptions(
    telegram: telegram != null,
    google: Env.googleSignInConfigured,
    apple: !kIsWeb && Platform.isIOS && Env.appleSignInEnabled,
    dev: Env.devSignIn,
  );
});

/// Customer sign-in and sign-out.
///
/// Customers never have a password: they come in through Telegram, Google or
/// Apple, exactly as on the web. Each provider hands us a signed assertion
/// that the API verifies before issuing our own token pair.
class AuthService {
  AuthService(this._ref);

  final Ref _ref;
  bool _googleReady = false;

  TakeAwayApi get _api => _ref.read(apiProvider);
  SessionManager get _sessions => _ref.read(sessionManagerProvider);

  /// Telegram Login (OpenID Connect): confirmed inside the Telegram app when
  /// it is installed, on Telegram's page otherwise. The API verifies the
  /// resulting ID token against Telegram's keys and our client id.
  Future<void> signInWithTelegram() async {
    final config = await _ref.read(telegramConfigProvider.future);
    if (config == null) throw StateError('Telegram sign-in is not configured');

    final String idToken;
    try {
      idToken = await _ref.read(telegramLoginFactoryProvider)(config.clientId!).login();
    } on TelegramLoginCancelled {
      throw const SignInCancelled();
    }
    await _complete(await _api.signInWithTelegramIdToken(TelegramIdTokenRequest(idToken)));
  }

  Future<void> signInWithGoogle() async {
    final google = GoogleSignIn.instance;
    if (!_googleReady) {
      await google.initialize(
        clientId: Platform.isIOS && Env.googleIosClientId.isNotEmpty ? Env.googleIosClientId : null,
        serverClientId: Env.googleServerClientId,
      );
      _googleReady = true;
    }
    final GoogleSignInAccount account;
    try {
      account = await google.authenticate(scopeHint: const ['email', 'profile']);
    } on GoogleSignInException catch (error) {
      if (error.code == GoogleSignInExceptionCode.canceled ||
          error.code == GoogleSignInExceptionCode.interrupted ||
          error.code == GoogleSignInExceptionCode.uiUnavailable) {
        throw const SignInCancelled();
      }
      rethrow;
    }
    final idToken = account.authentication.idToken;
    if (idToken == null) throw StateError('Google returned no ID token');
    await _complete(await _api.signInWithGoogle(OAuthLoginRequest(idToken: idToken)));
  }

  Future<void> signInWithApple() async {
    final AuthorizationCredentialAppleID credential;
    try {
      credential = await SignInWithApple.getAppleIDCredential(
        scopes: const [AppleIDAuthorizationScopes.email, AppleIDAuthorizationScopes.fullName],
      );
    } on SignInWithAppleAuthorizationException catch (error) {
      if (error.code == AuthorizationErrorCode.canceled) throw const SignInCancelled();
      rethrow;
    }
    final idToken = credential.identityToken;
    if (idToken == null) throw StateError('Apple returned no identity token');
    // Apple reveals the name only on the very first consent.
    final name = [credential.givenName, credential.familyName].whereType<String>().join(' ').trim();
    await _complete(await _api.signInWithApple(OAuthLoginRequest(idToken: idToken, name: name.isEmpty ? null : name)));
  }

  /// Debug builds against a local API only: the widget endpoint accepts an
  /// unsigned payload while no bot token is configured outside production.
  Future<void> devSignIn() async {
    assert(Env.devSignIn, 'devSignIn is only available in debug builds with DEV_SIGN_IN=true');
    final payload = <String, dynamic>{
      'id': 900000001,
      'first_name': 'Mobile',
      'last_name': 'Tester',
      'username': 'takeaway_mobile_dev',
      'auth_date': DateTime.now().millisecondsSinceEpoch ~/ 1000,
      'hash': 'dev',
    };
    await _complete(await _api.signInWithTelegram(payload));
  }

  Future<void> _complete(AuthSessionResponse response) async {
    await _sessions.start(Session.fromTokens(response.tokens, response.user));
    unawaited(_ref.read(pushServiceProvider).syncToken());
  }

  Future<AuthUser> refreshProfile() async {
    final user = await _api.me();
    await _sessions.updateUser(user);
    return user;
  }

  Future<AuthUser> updateProfile(Map<String, dynamic> patch) async {
    final user = await _api.updateMe(patch);
    await _sessions.updateUser(user);
    return user;
  }

  Future<void> signOut() async {
    final session = _sessions.current;
    if (session == null) return;
    await _ref.read(pushServiceProvider).unregister();
    try {
      await _api.logout(RefreshRequest(session.refreshToken));
    } on Object {
      // The refresh token dies with its TTL anyway; never block sign-out.
    }
    if (_googleReady) unawaited(GoogleSignIn.instance.signOut().catchError((Object _) {}));
    await _sessions.end(SessionEndReason.signedOut);
  }
}

/// Builds the Telegram Login flow for a client id; overridden in tests.
final telegramLoginFactoryProvider = Provider<TelegramLogin Function(String clientId)>(
  (ref) =>
      (clientId) => TelegramLogin(
        clientId: clientId,
        redirectUri: Uri.parse(Env.telegramRedirectUri),
        browserRedirectUri: Platform.isAndroid && Env.telegramAndroidAppLink.isNotEmpty
            ? Uri.parse(Env.telegramAndroidAppLink)
            : null,
        platform: DeviceTelegramLoginPlatform(),
      ),
);

final authServiceProvider = Provider<AuthService>((ref) => AuthService(ref));
