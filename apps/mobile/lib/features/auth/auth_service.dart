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
import '../../core/storage/app_prefs.dart';
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

/// The three ways a customer can sign in.
enum SignInProvider { telegram, google, apple }

/// Which sign-in buttons this build can offer.
class SignInOptions {
  const SignInOptions({required this.telegram, required this.google, required this.apple, required this.dev});

  final bool telegram;
  final bool google;
  final bool apple;
  final bool dev;

  bool get any => telegram || google || apple || dev;

  bool offers(SignInProvider provider) => switch (provider) {
    SignInProvider.telegram => telegram,
    SignInProvider.google => google,
    SignInProvider.apple => apple,
  };
}

final signInOptionsProvider = FutureProvider<SignInOptions>((ref) async {
  final telegram = await ref.watch(telegramConfigProvider.future);
  return SignInOptions(
    telegram: telegram != null,
    google: Env.googleSignInConfigured,
    apple: ref.watch(appleAuthorizationProvider).available,
    dev: Env.devSignIn,
  );
});

/// Apple's own Sign in with Apple sheet.
class AppleAuthorization {
  const AppleAuthorization();

  /// Offered on iOS only, and only when enabled for this build: the bundle
  /// id also has to be listed in the API's `APPLE_OAUTH_CLIENT_IDS`.
  bool get available => !kIsWeb && Platform.isIOS && Env.appleSignInEnabled;

  Future<AuthorizationCredentialAppleID> request(List<AppleIDAuthorizationScopes> scopes) =>
      SignInWithApple.getAppleIDCredential(scopes: scopes);
}

/// Overridden in tests.
final appleAuthorizationProvider = Provider<AppleAuthorization>((ref) => const AppleAuthorization());

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
    await _complete(await _api.signInWithTelegramIdToken(TelegramIdTokenRequest(await _telegramIdToken())));
  }

  Future<void> signInWithGoogle() async {
    await _complete(await _api.signInWithGoogle(await _googleCredential()));
  }

  Future<void> signInWithApple() async {
    await _complete(await _api.signInWithApple(await _appleCredential()));
  }

  // ── Linking ───────────────────────────────────────────────────────────
  //
  // A customer who started in the Telegram Mini App has no email, so Google
  // or Apple on the phone cannot find their profile by address. Linking
  // from the profile screen joins the methods explicitly.

  Future<SignInMethods> signInMethods() => _api.signInMethods();

  Future<SignInMethods> link(SignInProvider provider) async {
    final result = switch (provider) {
      SignInProvider.telegram => await _api.linkTelegram(TelegramIdTokenRequest(await _telegramIdToken())),
      SignInProvider.google => await _api.linkGoogle(await _googleCredential()),
      SignInProvider.apple => await _api.linkApple(await _appleCredential()),
    };
    // The API moved this (empty) profile into the one the method already
    // led to, where the order history is: continue as that customer.
    final session = result.session;
    if (session != null) await _complete(session);
    return result.methods;
  }

  Future<SignInMethods> unlink(SignInProvider provider) {
    assert(provider != SignInProvider.telegram, 'Telegram cannot be unlinked');
    return _api.unlinkSignInMethod(provider.name);
  }

  // ── Provider credentials ──────────────────────────────────────────────

  Future<String> _telegramIdToken() async {
    final config = await _ref.read(telegramConfigProvider.future);
    if (config == null) throw StateError('Telegram sign-in is not configured');
    try {
      return await _ref.read(telegramLoginFactoryProvider)(config.clientId!).login();
    } on TelegramLoginCancelled {
      throw const SignInCancelled();
    }
  }

  Future<OAuthLoginRequest> _googleCredential() async {
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
    return OAuthLoginRequest(idToken: idToken);
  }

  Future<OAuthLoginRequest> _appleCredential() async {
    final credential = await _askApple(const [AppleIDAuthorizationScopes.email, AppleIDAuthorizationScopes.fullName]);
    final idToken = credential.identityToken;
    if (idToken == null) throw StateError('Apple returned no identity token');
    // Apple reveals the name only on the very first consent.
    final name = [credential.givenName, credential.familyName].whereType<String>().join(' ').trim();
    return OAuthLoginRequest(idToken: idToken, name: name.isEmpty ? null : name);
  }

  Future<AuthorizationCredentialAppleID> _askApple(List<AppleIDAuthorizationScopes> scopes) async {
    try {
      return await _ref.read(appleAuthorizationProvider).request(scopes);
    } on SignInWithAppleAuthorizationException catch (error) {
      if (error.code == AuthorizationErrorCode.canceled) throw const SignInCancelled();
      rethrow;
    }
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
    await _forgetSession();
  }

  /// Whether deleting the account starts with a confirmation in Apple's
  /// sheet: this build offers Sign in with Apple and Apple leads into this
  /// profile.
  Future<bool> deletionNeedsApple() async {
    if (!_ref.read(appleAuthorizationProvider).available) return false;
    return (await signInMethods()).apple;
  }

  /// Deletes the customer's account on the server, then forgets it on this
  /// device the way [signOut] does. When the API refuses (403 for staff) or
  /// cannot be reached, the error propagates and the customer stays signed in.
  ///
  /// A profile Apple leads into first asks Apple for a fresh authorization
  /// code, which the API uses to revoke the tokens Apple issued for it
  /// (App Review guideline 5.1.1(v)). Backing out of Apple's sheet throws
  /// [SignInCancelled] and nothing is deleted.
  Future<void> deleteAccount() async {
    if (_sessions.current == null) return;
    final appleCode = await deletionNeedsApple() ? (await _askApple(const [])).authorizationCode : null;
    final push = _ref.read(pushServiceProvider);
    // Detach the device while the token still works: once the account is
    // gone every authenticated call answers 401, which would read as an
    // expired session.
    await push.unregister();
    try {
      await _api.deleteMe(DeleteAccountRequest(appleAuthorizationCode: appleCode));
    } on Object {
      unawaited(push.syncToken());
      rethrow;
    }
    // The refresh tokens went with the account, so there is nothing to log
    // out of. The contact details checkout remembered are personal data too.
    await _ref.read(contactPrefsProvider).forget();
    await _forgetSession();
  }

  Future<void> _forgetSession() async {
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
