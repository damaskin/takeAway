import 'dart:async';
import 'dart:convert';
import 'dart:io';
import 'dart:math';

import 'package:app_links/app_links.dart';
import 'package:crypto/crypto.dart';
import 'package:dio/dio.dart';
import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_web_auth_2/flutter_web_auth_2.dart';
import 'package:url_launcher/url_launcher.dart';

/// Telegram Login (OpenID Connect) for the app, done the way Telegram's own
/// iOS and Android SDKs do it (core.telegram.org/bots/telegram-login):
///
/// 1. An authorization-code request with PKCE. When Telegram is installed,
///    `oauth.telegram.org/crossapp` turns it into a `tg://` link and the
///    customer confirms inside Telegram; otherwise the authorization page
///    opens in the system browser sheet.
/// 2. Telegram sends the customer back through [redirectUri] with a code.
/// 3. The code and the PKCE verifier buy an ID token from `/token` — a
///    public-client exchange, so no secret ever ships in the app.
///
/// The ID token is what the API verifies (signature, issuer, our client id)
/// before it signs anyone in. Written in Dart rather than wrapping the SDKs:
/// the protocol is a few requests, the Android SDK is only published to a
/// registry that needs a GitHub token to build, and this keeps one code path
/// for both platforms.
class TelegramLogin {
  TelegramLogin({
    required this.clientId,
    required this.redirectUri,
    required this.platform,
    Dio? http,
    Random? random,
    this.scopes = defaultScopes,
    this.resumeGrace = const Duration(milliseconds: 1500),
  }) : _http = http ?? Dio(BaseOptions(connectTimeout: _timeout, receiveTimeout: _timeout)),
       _random = random ?? Random.secure();

  /// `profile` carries the Telegram user id the API keys accounts on;
  /// `telegram:bot_access` lets the bot message order updates.
  static const defaultScopes = ['openid', 'profile', 'telegram:bot_access'];

  static const _origin = 'https://oauth.telegram.org';
  static const _timeout = Duration(seconds: 15);

  final String clientId;
  final Uri redirectUri;
  final TelegramLoginPlatform platform;
  final List<String> scopes;

  /// How long to wait for the redirect after the app comes back to the
  /// foreground on its own, before treating the attempt as abandoned. The
  /// redirect itself also brings the app forward, a moment before the link.
  final Duration resumeGrace;

  final Dio _http;
  final Random _random;

  /// Runs the whole flow and returns Telegram's ID token. Throws
  /// [TelegramLoginCancelled] when the customer backs out, and
  /// [TelegramLoginException] when Telegram refuses.
  Future<String> login() async {
    final verifier = _randomToken(32);
    final challenge = codeChallengeFor(verifier);
    final state = _randomToken(16);

    Uri? callback;
    var handled = false;

    // Inside Telegram the customer is already signed in: one tap.
    if (await platform.hasTelegramApp()) {
      final appLink = await _crossAppLink(challenge);
      if (appLink != null) {
        final redirect = _waitForRedirect();
        if (await platform.launchExternal(appLink)) {
          callback = await redirect.future;
          handled = true;
        } else {
          redirect.cancel();
        }
      }
    }

    if (!handled) {
      final outcome = await platform.authenticateInBrowser(
        authorizationUrl(challenge: challenge, state: state),
        callbackScheme: redirectUri.scheme,
      );
      callback = switch (outcome) {
        BrowserRedirect(:final uri) => uri,
        BrowserCancelled() => null,
        BrowserAwaitsDeepLink(:final redirect) => await redirect,
      };
    }

    if (callback == null) throw const TelegramLoginCancelled();
    final code = codeFromRedirect(callback, expectedState: state);
    return _exchange(code: code, verifier: verifier);
  }

  /// The browser authorization request (the standard OIDC endpoint).
  Uri authorizationUrl({required String challenge, required String state}) => Uri.parse('$_origin/auth').replace(
    queryParameters: {
      'client_id': clientId,
      'response_type': 'code',
      'redirect_uri': redirectUri.toString(),
      'scope': scopes.join(' '),
      'state': state,
      'code_challenge': challenge,
      'code_challenge_method': 'S256',
      if (platform.sdkParameter == 'ios_sdk') 'ios_sdk': '1',
    },
  );

  /// Asks Telegram for the `tg://` link that opens this request in the app.
  /// Null when Telegram has none for us — the browser takes over then.
  Future<Uri?> _crossAppLink(String challenge) async {
    try {
      final response = await _http.getUri<Object?>(
        Uri.parse('$_origin/crossapp').replace(
          queryParameters: {
            'client_id': clientId,
            'response_type': 'code',
            'redirect_uri': redirectUri.toString(),
            'scope': scopes.join(' '),
            platform.sdkParameter: '1',
            'code_challenge': challenge,
            'code_challenge_method': 'S256',
          },
        ),
        options: Options(headers: {'Accept': 'application/json'}, responseType: ResponseType.json),
      );
      final body = _json(response.data);
      final nested = body['result'];
      final url = body['url'] ?? (nested is Map ? nested['url'] : null);
      return url is String && url.isNotEmpty ? Uri.tryParse(url) : null;
    } on Object {
      return null;
    }
  }

  Future<String> _exchange({required String code, required String verifier}) async {
    final Response<Object?> response;
    try {
      response = await _http.postUri<Object?>(
        Uri.parse('$_origin/token'),
        data: {
          'grant_type': 'authorization_code',
          'client_id': clientId,
          'code': code,
          'redirect_uri': redirectUri.toString(),
          'code_verifier': verifier,
        },
        options: Options(
          contentType: Headers.formUrlEncodedContentType,
          headers: {'Accept': 'application/json'},
          responseType: ResponseType.json,
        ),
      );
    } on DioException catch (error) {
      if (error.response == null) rethrow; // offline: let the caller say so
      final body = _json(error.response!.data);
      throw TelegramLoginException((body['error_description'] ?? body['error'] ?? 'token request failed').toString());
    }
    final body = _json(response.data);
    final token = body['id_token'] ?? body['result'];
    if (token is String && token.split('.').length == 3) return token;
    throw TelegramLoginException((body['error'] ?? 'Telegram returned no ID token').toString());
  }

  /// A pending wait for Telegram to send the customer back through
  /// [redirectUri]. Coming back to the app any other way — the back button,
  /// the app switcher — ends it after [resumeGrace].
  _PendingRedirect _waitForRedirect() =>
      _PendingRedirect(links: platform.deepLinks.where(isRedirect), resumes: platform.resumes, grace: resumeGrace);

  /// Whether [uri] is our redirect coming back.
  bool isRedirect(Uri uri) =>
      uri.scheme == redirectUri.scheme && uri.host == redirectUri.host && uri.path == redirectUri.path;

  String _randomToken(int bytes) =>
      base64UrlEncode(List<int>.generate(bytes, (_) => _random.nextInt(256))).replaceAll('=', '');

  static Map<String, Object?> _json(Object? data) {
    if (data is Map) return data.cast<String, Object?>();
    if (data is String && data.isNotEmpty) {
      try {
        final decoded = jsonDecode(data);
        if (decoded is Map) return decoded.cast<String, Object?>();
      } on FormatException {
        // not JSON — handled as an empty body
      }
    }
    return const {};
  }
}

/// PKCE S256: base64url(sha256(verifier)) without padding (RFC 7636).
String codeChallengeFor(String verifier) =>
    base64UrlEncode(sha256.convert(ascii.encode(verifier)).bytes).replaceAll('=', '');

/// The authorization code from Telegram's redirect. A `state` that came back
/// must be ours; Telegram's app flow does not echo one, and PKCE binds the
/// code to this attempt either way.
String codeFromRedirect(Uri redirect, {required String expectedState}) {
  final params = redirect.queryParameters;
  final error = params['error'];
  if (error != null) {
    if (error == 'access_denied') throw const TelegramLoginCancelled();
    throw TelegramLoginException(params['error_description'] ?? error);
  }
  final state = params['state'];
  if (state != null && state != expectedState) {
    throw const TelegramLoginException('The sign-in response does not belong to this attempt');
  }
  final code = params['code'];
  if (code == null || code.isEmpty) throw const TelegramLoginCancelled();
  return code;
}

/// The customer closed Telegram or the sign-in page without confirming.
class TelegramLoginCancelled implements Exception {
  const TelegramLoginCancelled();
}

/// Telegram refused the request (unregistered redirect, bad client id…).
class TelegramLoginException implements Exception {
  const TelegramLoginException(this.message);

  final String message;

  @override
  String toString() => 'TelegramLoginException: $message';
}

/// What the browser part of the flow produced.
sealed class BrowserOutcome {
  const BrowserOutcome();
}

/// The platform captured the redirect itself (iOS's authentication session).
class BrowserRedirect extends BrowserOutcome {
  const BrowserRedirect(this.uri);
  final Uri uri;
}

/// The customer closed the page.
class BrowserCancelled extends BrowserOutcome {
  const BrowserCancelled();
}

/// The page is open in a browser tab and the redirect will come back as a
/// deep link (Android Custom Tabs); [redirect] completes with it, or with
/// null when the customer returns without one.
class BrowserAwaitsDeepLink extends BrowserOutcome {
  const BrowserAwaitsDeepLink(this.redirect);
  final Future<Uri?> redirect;
}

/// Everything platform-specific the flow needs, so it can be tested without
/// a device.
abstract class TelegramLoginPlatform {
  /// `ios_sdk` or `android_sdk` — tells Telegram which app to hand back to.
  String get sdkParameter;

  /// Whether an app that opens `tg://` links is installed.
  Future<bool> hasTelegramApp();

  /// Opens [url] in another app; false when nothing handles it.
  Future<bool> launchExternal(Uri url);

  /// Opens the authorization page in the system browser sheet.
  Future<BrowserOutcome> authenticateInBrowser(Uri url, {required String callbackScheme});

  /// Deep links delivered while the app is running.
  Stream<Uri> get deepLinks;

  /// Fires each time the app returns to the foreground.
  Stream<void> get resumes;
}

/// Waits for the first matching link; a return to the foreground without
/// one ends the wait with null after a grace period.
class _PendingRedirect {
  _PendingRedirect({required Stream<Uri> links, required Stream<void> resumes, required Duration grace}) {
    _links = links.listen(_finish);
    _resumes = resumes.listen((_) {
      _grace?.cancel();
      _grace = Timer(grace, () => _finish(null));
    });
  }

  final _completer = Completer<Uri?>();
  late final StreamSubscription<Uri> _links;
  late final StreamSubscription<void> _resumes;
  Timer? _grace;

  Future<Uri?> get future => _completer.future;

  void cancel() => _finish(null);

  void _finish(Uri? uri) {
    if (_completer.isCompleted) return;
    _completer.complete(uri);
    _grace?.cancel();
    unawaited(_links.cancel());
    unawaited(_resumes.cancel());
  }
}

/// The real device: `url_launcher` for Telegram and Android's Custom Tabs,
/// iOS's authentication session through `flutter_web_auth_2`, and the
/// redirect from Telegram's app arriving through `app_links`.
class DeviceTelegramLoginPlatform implements TelegramLoginPlatform {
  DeviceTelegramLoginPlatform({AppLinks? appLinks, this.resumeGrace = const Duration(milliseconds: 1500)})
    : _appLinks = appLinks ?? AppLinks();

  final AppLinks _appLinks;
  final Duration resumeGrace;

  @override
  String get sdkParameter => Platform.isIOS ? 'ios_sdk' : 'android_sdk';

  @override
  Future<bool> hasTelegramApp() => canLaunchUrl(Uri.parse('tg://resolve'));

  @override
  Future<bool> launchExternal(Uri url) async {
    try {
      return await launchUrl(url, mode: LaunchMode.externalApplication);
    } on PlatformException {
      return false;
    }
  }

  @override
  Future<BrowserOutcome> authenticateInBrowser(Uri url, {required String callbackScheme}) async {
    if (Platform.isIOS) {
      // ASWebAuthenticationSession: shares Safari's Telegram session and
      // dismisses itself on the redirect.
      try {
        final result = await FlutterWebAuth2.authenticate(url: url.toString(), callbackUrlScheme: callbackScheme);
        return BrowserRedirect(Uri.parse(result));
      } on PlatformException catch (error) {
        if (error.code == 'CANCELED' || error.code == 'CANCELLED') return const BrowserCancelled();
        rethrow;
      }
    }
    // Android: a Custom Tab, as Telegram's SDK does. The redirect reopens
    // MainActivity (singleTask clears the tab) and arrives as a deep link.
    final pending = _PendingRedirect(
      links: deepLinks.where((uri) => uri.scheme == callbackScheme),
      resumes: resumes,
      grace: resumeGrace,
    );
    if (!await launchUrl(url, mode: LaunchMode.inAppBrowserView)) {
      pending.cancel();
      return const BrowserCancelled();
    }
    return BrowserAwaitsDeepLink(pending.future);
  }

  @override
  Stream<Uri> get deepLinks => _appLinks.uriLinkStream;

  @override
  Stream<void> get resumes {
    late final StreamController<void> controller;
    AppLifecycleListener? listener;
    controller = StreamController<void>(
      onListen: () => listener = AppLifecycleListener(onResume: () => controller.add(null)),
      onCancel: () => listener?.dispose(),
    );
    return controller.stream;
  }
}
