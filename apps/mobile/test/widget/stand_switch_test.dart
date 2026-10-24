import 'package:dio/dio.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/app/app_root.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/core/auth/session_manager.dart';
import 'package:takeaway_mobile/core/config/env.dart';
import 'package:takeaway_mobile/core/config/stand.dart';
import 'package:takeaway_mobile/core/providers.dart';
import 'package:takeaway_mobile/core/realtime/realtime_service.dart';
import 'package:takeaway_mobile/core/storage/json_cache.dart';
import 'package:takeaway_mobile/core/theme/app_theme.dart';
import 'package:takeaway_mobile/features/auth/auth_service.dart';
import 'package:takeaway_mobile/features/auth/sign_in_sheet.dart';
import 'package:takeaway_mobile/shared/widgets/cup_logo.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

/// Sign in with Apple as on an iPhone, without Apple's sheet.
class _AppleOnThisPhone extends AppleAuthorization {
  @override
  bool get available => true;

  @override
  Future<AuthorizationCredentialAppleID> request(List<AppleIDAuthorizationScopes> scopes) => throw UnimplementedError();
}

/// An API that cannot be reached.
class _OfflineApi extends FakeApi {
  @override
  Future<void> logout(RefreshRequest body) => Future.error(
    DioException.connectionError(
      requestOptions: RequestOptions(path: '/auth/logout'),
      reason: 'offline',
    ),
  );
}

void main() {
  tearDown(() => Env.stand = Stand.prod);

  late SharedPreferences prefs;
  late MemorySessionStorage storage;
  late List<FakeApi> apis;

  /// What `bootstrap()` does, with fakes: the saved stand, the session left
  /// in storage, a fresh API client for the stand.
  Future<ProviderContainer> boot() async {
    Env.stand = Stand.restore(prefs);
    final api = FakeApi();
    apis.add(api);
    final sessions = SessionManager(storage: storage, initial: await SessionManager.restore(storage));
    return ProviderContainer(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        sessionManagerProvider.overrideWithValue(sessions),
        jsonCacheProvider.overrideWithValue(MemoryJsonCache()),
        apiProvider.overrideWithValue(api),
        realtimeServiceProvider.overrideWith((ref) {
          ref.watch(currentUserIdProvider);
          final realtime = FakeRealtime(sessions);
          ref.onDispose(realtime.dispose);
          return realtime;
        }),
      ],
    );
  }

  /// The app as `main()` starts it, on the stand saved in [saved].
  Future<void> launch(WidgetTester tester, {bool signedIn = true, Map<String, Object> saved = const {}}) async {
    AppTheme.useGoogleFonts = false;
    SharedPreferences.setMockInitialValues({'app.onboarding.done': true, 'app.locale': 'ru', ...saved});
    prefs = await SharedPreferences.getInstance();
    storage = MemorySessionStorage();
    if (signedIn) await SessionManager(storage: storage).start(testSession());
    apis = [];
    await tester.binding.setSurfaceSize(const Size(412, 915));
    addTearDown(() => tester.binding.setSurfaceSize(null));
    await tester.pumpWidget(AppRoot(container: await boot(), boot: boot));
    await settle(tester);
  }

  ProviderContainer current(WidgetTester tester) =>
      tester.widget<UncontrolledProviderScope>(find.byType(UncontrolledProviderScope)).container;

  Future<void> unmount(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox());
    await tester.pump(const Duration(seconds: 1));
  }

  testWidgets('a long press on the logo of «О приложении» moves a signed-in tester to the test stand', (tester) async {
    await launch(
      tester,
      saved: {
        'app.activeStoreId': 'st_1',
        'flags.cards': true,
        'push.registration': 'u1|token',
        'checkout.name': 'Иван',
      },
    );
    current(tester).read(routerProvider).go(Routes.about);
    await settle(tester);
    expect(find.byType(Banner), findsNothing);

    await tester.longPress(find.byType(AnimatedCupLogo));
    await settle(tester);

    expect(find.text('Сервер'), findsOneWidget);
    expect(find.widgetWithText(ListTile, 'api.takeaway.md'), findsOneWidget);
    expect(find.widgetWithText(ListTile, 'test-api.takeaway.md'), findsOneWidget);

    await tester.tap(find.widgetWithText(ListTile, 'Тест'));
    await settle(tester);

    // Signed out of production first, with the phone's leftovers of it gone…
    expect(apis.first.logouts, ['refresh']);
    expect(prefs.getString('app.stand'), 'test');
    expect(prefs.containsKey('app.activeStoreId'), isFalse);
    expect(prefs.containsKey('push.registration'), isFalse);
    // Staging's own answer by now, not production's cached one.
    expect(prefs.getBool('flags.cards'), isFalse);
    expect(prefs.getString('checkout.name'), 'Иван');
    expect(prefs.getBool('app.onboarding.done'), isTrue);

    // …then started over against staging, signed out, on the stores list.
    expect(apis, hasLength(2));
    expect(Env.stand, Stand.test);
    expect(Env.apiBaseUrl, 'https://test-api.takeaway.md/api');
    expect(current(tester).read(isSignedInProvider), isFalse);
    expect(current(tester).read(routerProvider).state.uri.path, Routes.stores);
    expect(find.text('Сервер'), findsNothing);
    expect(tester.widget<Banner>(find.byType(Banner)).message, 'TEST');
    await unmount(tester);
  });

  testWidgets('the sign-in sheet names the stand and opens the picker from its logo', (tester) async {
    await launch(tester, signedIn: false, saved: {'app.stand': 'test'});
    current(tester).read(routerProvider).go(Routes.profile);
    await settle(tester);
    await tester.tap(find.text('Войти'));
    await settle(tester);

    expect(find.text('Сервер «Тест» · test-api.takeaway.md'), findsOneWidget);

    await tester.longPress(find.descendant(of: find.byType(SignInSheet), matching: find.byType(CupLogo)));
    await settle(tester);
    final testTile = find.widgetWithText(ListTile, 'Тест');
    expect(find.descendant(of: testTile, matching: find.byIcon(Icons.check_rounded)), findsOneWidget);

    // The stand the app is on already: the sheet just closes.
    await tester.tap(testTile);
    await settle(tester);
    expect(find.text('Сервер'), findsNothing);
    expect(apis, hasLength(1));
    await unmount(tester);
  });

  test('leaving a stand forgets what the phone kept of that server, even offline', () async {
    SharedPreferences.setMockInitialValues({
      'app.activeStoreId': 'st_1',
      'flags.delivery': true,
      'flags.cards': true,
      'flags.cardFlow': 'web',
      'push.registration': 'u1|token',
      'stores.radius': 'km2',
    });
    final prefs = await SharedPreferences.getInstance();
    final storage = MemorySessionStorage();
    final sessions = SessionManager(storage: storage);
    await sessions.start(testSession());
    final container = ProviderContainer(
      overrides: [
        sharedPreferencesProvider.overrideWithValue(prefs),
        sessionManagerProvider.overrideWithValue(sessions),
        // The API cannot be reached: sign-out still ends the session here.
        apiProvider.overrideWithValue(_OfflineApi()),
      ],
    );

    await leaveStand(container, Stand.test);

    expect(sessions.current, isNull);
    expect(await storage.read(), isNull);
    expect(prefs.getKeys(), {'app.stand', 'stores.radius'});
    expect(prefs.getString('app.stand'), 'test');
    container.dispose();
  });

  test('Apple sign-in is offered only where the API can complete it', () async {
    for (final (onServer, offered) in [(true, true), (false, false)]) {
      final container = ProviderContainer(
        overrides: [
          apiProvider.overrideWithValue(FakeApi()..authMethodsAnswer = AuthMethods(telegram: true, apple: onServer)),
          appleAuthorizationProvider.overrideWithValue(_AppleOnThisPhone()),
        ],
      );
      expect((await container.read(signInOptionsProvider.future)).apple, offered);
      container.dispose();
    }
  });
}
