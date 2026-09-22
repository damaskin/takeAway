import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/app/app.dart';
import 'package:takeaway_mobile/core/auth/session.dart';
import 'package:takeaway_mobile/core/auth/session_manager.dart';
import 'package:takeaway_mobile/core/providers.dart';
import 'package:takeaway_mobile/core/realtime/realtime_service.dart';
import 'package:takeaway_mobile/core/storage/json_cache.dart';
import 'package:takeaway_mobile/core/theme/app_theme.dart';

import 'fake_api.dart';

/// Realtime without a socket: tests push status events by hand.
class FakeRealtime extends RealtimeService {
  FakeRealtime(super.sessions);

  final _controller = StreamController<OrderStatusEvent>.broadcast();

  @override
  Stream<OrderStatusEvent> get events => _controller.stream;

  @override
  void connect() => connected.value = true;

  @override
  VoidCallback watchOrder(String orderId) => () {};

  void emit(OrderStatusEvent event) => _controller.add(event);

  @override
  void dispose() {
    unawaited(_controller.close());
    super.dispose();
  }
}

class Harness {
  Harness({required this.api, required this.container, required this.realtime});

  final FakeApi api;
  final ProviderContainer container;
  final FakeRealtime realtime;
  bool _disposed = false;

  /// Unmounts the app and disposes the providers, so periodic timers (order
  /// polling, countdowns) stop before the test's pending-timer check.
  Future<void> unmount(WidgetTester tester) async {
    await tester.pumpWidget(const SizedBox());
    if (!_disposed) {
      _disposed = true;
      container.dispose();
    }
    await tester.pump(const Duration(seconds: 1));
  }
}

const testUser = AuthUser(id: 'u1', locale: 'RU', currency: 'MDL', role: 'CUSTOMER', name: 'Иван Дамаскин');

Session testSession() => Session(
  accessToken: 'access',
  refreshToken: 'refresh',
  accessExpiresAt: DateTime.now().add(const Duration(hours: 1)),
  refreshExpiresAt: DateTime.now().add(const Duration(days: 7)),
  user: testUser,
);

/// Boots the real app (router, theme, localisation) against [FakeApi].
Future<Harness> pumpApp(
  WidgetTester tester, {
  FakeApi? api,
  bool signedIn = true,
  bool onboarded = true,
  Locale locale = const Locale('ru'),
}) async {
  AppTheme.useGoogleFonts = false;
  SharedPreferences.setMockInitialValues({'app.onboarding.done': onboarded, 'app.locale': locale.languageCode});
  final prefs = await SharedPreferences.getInstance();
  final fakeApi = api ?? FakeApi();
  final sessions = SessionManager(storage: MemorySessionStorage(), initial: signedIn ? testSession() : null);
  late FakeRealtime realtime;

  final container = ProviderContainer(
    overrides: [
      sharedPreferencesProvider.overrideWithValue(prefs),
      sessionManagerProvider.overrideWithValue(sessions),
      jsonCacheProvider.overrideWithValue(MemoryJsonCache()),
      apiProvider.overrideWithValue(fakeApi),
      realtimeServiceProvider.overrideWith((ref) {
        ref.watch(currentUserIdProvider);
        realtime = FakeRealtime(sessions);
        ref.onDispose(realtime.dispose);
        return realtime;
      }),
    ],
  );

  await tester.binding.setSurfaceSize(const Size(412, 915));
  addTearDown(() => tester.binding.setSurfaceSize(null));

  await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const TakeAwayApp()));
  await settle(tester);
  container.read(realtimeServiceProvider);
  final harness = Harness(api: fakeApi, container: container, realtime: realtime);
  addTearDown(() {
    if (!harness._disposed) container.dispose();
  });
  return harness;
}

/// `pumpAndSettle` never settles with the app's looping animations (steam,
/// shimmer, the live dot), so advance time in steps instead.
Future<void> settle(WidgetTester tester, [Duration total = const Duration(milliseconds: 1200)]) async {
  const step = Duration(milliseconds: 100);
  for (var elapsed = Duration.zero; elapsed < total; elapsed += step) {
    await tester.pump(step);
  }
}
