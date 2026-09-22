import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/features/auth/telegram_login.dart';

import '../helpers/fake_http.dart';

/// A device without a device: records what the flow opened and lets the test
/// play Telegram's part — sending the redirect back, or the customer
/// returning without one.
class FakePlatform implements TelegramLoginPlatform {
  FakePlatform({this.telegramInstalled = true, this.opensTelegram = true, this.onBrowser});

  bool telegramInstalled;
  bool opensTelegram;
  final FutureOr<BrowserOutcome> Function(Uri url)? onBrowser;

  final launched = <Uri>[];
  final browsed = <Uri>[];
  final _links = StreamController<Uri>.broadcast();
  final _resumes = StreamController<void>.broadcast();

  void sendLink(Uri uri) => _links.add(uri);
  void resume() => _resumes.add(null);

  @override
  String get sdkParameter => 'android_sdk';

  @override
  Future<bool> hasTelegramApp() async => telegramInstalled;

  @override
  Future<bool> launchExternal(Uri url) async {
    launched.add(url);
    return opensTelegram;
  }

  @override
  Future<BrowserOutcome> authenticateInBrowser(Uri url, {required String callbackScheme}) async {
    browsed.add(url);
    return onBrowser?.call(url) ?? const BrowserCancelled();
  }

  @override
  Stream<Uri> get deepLinks => _links.stream;

  @override
  Stream<void> get resumes => _resumes.stream;
}

const idToken = 'eyJhbGciOiJSUzI1NiJ9.eyJpZCI6OTg3NjU0MzIxfQ.c2ln';
final redirect = Uri.parse('takeaway://tglogin');

void main() {
  group('PKCE', () {
    test('derives the S256 challenge exactly as RFC 7636 does', () {
      // Appendix B of the RFC.
      expect(
        codeChallengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'),
        'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      );
    });
  });

  group('codeFromRedirect', () {
    test('takes the code, with or without an echoed state', () {
      expect(codeFromRedirect(Uri.parse('takeaway://tglogin?code=abc&state=s1'), expectedState: 's1'), 'abc');
      expect(codeFromRedirect(Uri.parse('takeaway://tglogin?code=abc'), expectedState: 's1'), 'abc');
    });

    test('refuses a response that belongs to another attempt', () {
      expect(
        () => codeFromRedirect(Uri.parse('takeaway://tglogin?code=abc&state=other'), expectedState: 's1'),
        throwsA(isA<TelegramLoginException>()),
      );
    });

    test('treats a declined consent as a cancellation, other errors as errors', () {
      expect(
        () => codeFromRedirect(Uri.parse('takeaway://tglogin?error=access_denied'), expectedState: 's1'),
        throwsA(isA<TelegramLoginCancelled>()),
      );
      expect(
        () => codeFromRedirect(
          Uri.parse('takeaway://tglogin?error=invalid_request&error_description=bad%20redirect'),
          expectedState: 's1',
        ),
        throwsA(isA<TelegramLoginException>().having((e) => e.message, 'message', 'bad redirect')),
      );
    });
  });

  group('TelegramLogin', () {
    late FakeAdapter http;
    late Dio dio;

    TelegramLogin flow(FakePlatform platform) => TelegramLogin(
      clientId: '7412345678',
      redirectUri: redirect,
      platform: platform,
      http: dio,
      resumeGrace: const Duration(milliseconds: 50),
    );

    void answer({Object? crossapp = const {'url': 'tg://oauth?token=xyz'}, int crossappStatus = 200}) {
      http = FakeAdapter((options) {
        if (options.uri.path == '/crossapp') return (crossappStatus, crossapp);
        if (options.uri.path == '/token') return (200, {'id_token': idToken});
        return (404, null);
      });
      dio = Dio()..httpClientAdapter = http;
    }

    RequestOptions sent(String path) => http.seen.singleWhere((o) => o.uri.path == path);

    test('with Telegram installed, the customer confirms in the app and comes back with a code', () async {
      answer();
      final platform = FakePlatform();
      final pending = flow(platform).login();
      await pumpEventQueue();

      expect(platform.launched.single.toString(), 'tg://oauth?token=xyz');
      final crossapp = sent('/crossapp').uri.queryParameters;
      expect(crossapp['client_id'], '7412345678');
      expect(crossapp['redirect_uri'], 'takeaway://tglogin');
      expect(crossapp['scope'], 'openid profile telegram:bot_access');
      expect(crossapp['android_sdk'], '1');
      expect(crossapp['code_challenge_method'], 'S256');

      // Telegram hands the customer back; some other link must not confuse it.
      platform
        ..sendLink(Uri.parse('takeaway://somewhere-else?code=nope'))
        ..sendLink(Uri.parse('takeaway://tglogin?code=the-code'));
      expect(await pending, idToken);

      final exchange = Map<String, dynamic>.from(sent('/token').data as Map);
      expect(exchange['grant_type'], 'authorization_code');
      expect(exchange['code'], 'the-code');
      expect(exchange['client_id'], '7412345678');
      expect(exchange['redirect_uri'], 'takeaway://tglogin');
      expect(exchange.containsKey('client_secret'), isFalse, reason: 'a public client: no secret in the app');
      // The verifier proves this is the attempt that asked for the code.
      expect(codeChallengeFor(exchange['code_verifier'] as String), crossapp['code_challenge']);
      expect(platform.browsed, isEmpty);
    });

    test('returning to the app without confirming ends the attempt as cancelled', () async {
      answer();
      final platform = FakePlatform();
      final pending = flow(platform).login();
      await pumpEventQueue();

      platform.resume();
      await expectLater(pending, throwsA(isA<TelegramLoginCancelled>()));
      expect(http.seen.where((o) => o.uri.path == '/token'), isEmpty);
    });

    test('without Telegram, the authorization page opens and its redirect is used', () async {
      answer();
      late Uri page;
      final platform = FakePlatform(
        telegramInstalled: false,
        onBrowser: (url) {
          page = url;
          return BrowserRedirect(Uri.parse('takeaway://tglogin?code=web-code&state=${url.queryParameters['state']}'));
        },
      );

      expect(await flow(platform).login(), idToken);
      expect(page.host, 'oauth.telegram.org');
      expect(page.path, '/auth');
      expect(page.queryParameters['response_type'], 'code');
      expect(page.queryParameters['state'], isNotEmpty);
      final exchange = Map<String, dynamic>.from(sent('/token').data as Map);
      expect(exchange['code'], 'web-code');
      expect(codeChallengeFor(exchange['code_verifier'] as String), page.queryParameters['code_challenge']);
      expect(http.seen.where((o) => o.uri.path == '/crossapp'), isEmpty);
    });

    test('falls back to the page when Telegram has no app link for us', () async {
      answer(crossapp: {'error': 'redirect_uri not allowed'}, crossappStatus: 400);
      final platform = FakePlatform(
        onBrowser: (url) =>
            BrowserRedirect(Uri.parse('takeaway://tglogin?code=c&state=${url.queryParameters['state']}')),
      );

      expect(await flow(platform).login(), idToken);
      expect(platform.launched, isEmpty);
      expect(platform.browsed, hasLength(1));
    });

    test('falls back to the page when the Telegram app cannot be opened', () async {
      answer();
      final platform = FakePlatform(
        opensTelegram: false,
        onBrowser: (url) =>
            BrowserRedirect(Uri.parse('takeaway://tglogin?code=c&state=${url.queryParameters['state']}')),
      );

      expect(await flow(platform).login(), idToken);
      expect(platform.browsed, hasLength(1));
    });

    test('an Android tab reports back through a deep link', () async {
      answer();
      final platform = FakePlatform(
        telegramInstalled: false,
        onBrowser: (url) => BrowserAwaitsDeepLink(
          Future.value(Uri.parse('takeaway://tglogin?code=tab-code&state=${url.queryParameters['state']}')),
        ),
      );

      expect(await flow(platform).login(), idToken);
      expect((sent('/token').data as Map)['code'], 'tab-code');
    });

    test('closing the page is a cancellation', () async {
      answer();
      final platform = FakePlatform(telegramInstalled: false);
      await expectLater(flow(platform).login(), throwsA(isA<TelegramLoginCancelled>()));
    });

    test("Telegram's refusal to exchange the code surfaces its reason", () async {
      http = FakeAdapter((options) {
        if (options.uri.path == '/token') {
          return (400, {'error': 'invalid_grant', 'error_description': 'code expired'});
        }
        return (404, null);
      });
      dio = Dio()..httpClientAdapter = http;
      final platform = FakePlatform(
        telegramInstalled: false,
        onBrowser: (url) =>
            BrowserRedirect(Uri.parse('takeaway://tglogin?code=c&state=${url.queryParameters['state']}')),
      );

      await expectLater(
        flow(platform).login(),
        throwsA(isA<TelegramLoginException>().having((e) => e.message, 'message', 'code expired')),
      );
    });
  });
}
