import 'dart:convert';
import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:takeaway_mobile/app/app.dart';
import 'package:takeaway_mobile/core/auth/session_manager.dart';
import 'package:takeaway_mobile/core/config/env.dart';
import 'package:takeaway_mobile/core/providers.dart';
import 'package:takeaway_mobile/features/cart/cart_controller.dart';
import 'package:takeaway_mobile/features/checkout/checkout_screen.dart';
import 'package:takeaway_mobile/features/checkout/checkout_sections.dart';
import 'package:takeaway_mobile/features/menu/menu_widgets.dart';
import 'package:takeaway_mobile/features/orders/order_status_screen.dart';
import 'package:takeaway_mobile/main.dart';
import 'package:takeaway_mobile/shared/widgets/pressable.dart';

/// End-to-end on a device or emulator against a real API with the dev seed
/// (`pnpm prisma:seed`): sign in, order a latte, pay at the counter, then
/// move the order through the kitchen with the KDS endpoints and watch the
/// app follow live.
///
///   flutter test integration_test/ordering_e2e_test.dart -d emulator-5554 \
///     --dart-define=API_BASE_URL=http://10.0.2.2:3000/api --dart-define=DEV_SIGN_IN=true \
///     --dart-define=E2E_STORE="takeAway Marina" \
///     --dart-define=E2E_STAFF_EMAIL=... --dart-define=E2E_STAFF_PASSWORD=...
///
/// The API must run outside production without TELEGRAM_BOT_TOKEN, which is
/// what lets the developer sign-in through.
const _storeName = String.fromEnvironment('E2E_STORE', defaultValue: 'takeAway Marina');
const _product = String.fromEnvironment('E2E_PRODUCT', defaultValue: 'Latte');
const _size = String.fromEnvironment('E2E_SIZE', defaultValue: 'Medium');
const _staffEmail = String.fromEnvironment('E2E_STAFF_EMAIL');
const _staffPassword = String.fromEnvironment('E2E_STAFF_PASSWORD');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  Future<void> pumpFor(WidgetTester tester, Duration total) async {
    final end = DateTime.now().add(total);
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  /// Pumps until [finder] matches or [timeout] passes. Real network, real
  /// socket — the UI gets there when the server says so.
  Future<void> waitFor(WidgetTester tester, Finder finder, {Duration timeout = const Duration(seconds: 20)}) async {
    final end = DateTime.now().add(timeout);
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 200));
      if (finder.evaluate().isNotEmpty) return;
    }
    throw TestFailure('Timed out waiting for $finder');
  }

  Future<void> tapWhenVisible(WidgetTester tester, Finder finder) async {
    await waitFor(tester, finder);
    await tester.ensureVisible(finder.first);
    await pumpFor(tester, const Duration(milliseconds: 400));
    await tester.tap(finder.first);
    await pumpFor(tester, const Duration(milliseconds: 600));
  }

  Future<Map<String, dynamic>> api(String method, String path, {String? token, Object? body}) async {
    final client = HttpClient();
    try {
      final request = await client.openUrl(method, Uri.parse('${Env.apiBaseUrl}$path'));
      if (token != null) request.headers.set('Authorization', 'Bearer $token');
      // Fastify refuses a JSON content type with an empty body.
      if (body != null) {
        request.headers.contentType = ContentType.json;
        request.write(jsonEncode(body));
      }
      final response = await request.close();
      final text = await response.transform(utf8.decoder).join();
      if (response.statusCode >= 300) throw HttpException('$method $path → ${response.statusCode}: $text');
      return text.isEmpty ? const {} : jsonDecode(text) as Map<String, dynamic>;
    } finally {
      client.close();
    }
  }

  testWidgets('guest orders a latte, pays at the counter and follows it to pickup', (tester) async {
    expect(Env.devSignIn, isTrue, reason: 'run with --dart-define=DEV_SIGN_IN=true');

    // debugPrint is throttled: whatever is still queued when the run ends —
    // including the failure itself — never leaves the device.
    final throttled = debugPrint;
    debugPrint = debugPrintSynchronously;
    addTearDown(() => debugPrint = throttled);

    // A clean first launch: no session, no remembered store, intro not seen.
    SharedPreferences.setMockInitialValues({});
    await SecureSessionStorage().delete();
    final container = await bootstrap();
    await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const TakeAwayApp()));
    await pumpFor(tester, const Duration(seconds: 2));

    // Intro → skip.
    await tapWhenVisible(tester, find.byType(TextButton));

    // Several stores → pick one.
    await tapWhenVisible(tester, find.text(_storeName));

    // Open the product and choose a bigger size.
    await tapWhenVisible(tester, find.text(_product));
    await waitFor(tester, find.byIcon(Icons.close_rounded));
    await tapWhenVisible(tester, find.text(_size));

    // Add → the guest is asked to sign in; the developer sign-in continues the add.
    await tapWhenVisible(tester, find.textContaining(RegExp('Add to cart|В корзину')));
    await tapWhenVisible(tester, find.textContaining(RegExp('Developer sign-in|Вход для разработки')));
    await pumpFor(tester, const Duration(seconds: 3));

    // Cart bar (once the item is in and the bar has slid in) → cart → checkout.
    final end = DateTime.now().add(const Duration(seconds: 15));
    while ((container.read(activeCartProvider).valueOrNull?.itemCount ?? 0) == 0) {
      if (DateTime.now().isAfter(end)) throw TestFailure('The cart stayed empty after adding');
      await tester.pump(const Duration(milliseconds: 200));
    }
    await pumpFor(tester, const Duration(milliseconds: 800));
    await tapWhenVisible(tester, find.byType(CartBar));
    await tapWhenVisible(tester, find.textContaining(RegExp('Checkout|К оформлению')));

    // After hours the store only takes scheduled pickups, and checkout opens
    // on the slot picker: take the first free window. In hours it is ASAP.
    await waitFor(tester, find.byType(CheckoutScreen));
    await pumpFor(tester, const Duration(seconds: 1));
    if (find.byType(SlotPicker).evaluate().isNotEmpty) {
      await tapWhenVisible(tester, find.descendant(of: find.byType(SlotPicker), matching: find.byType(Pressable)));
    }
    await tapWhenVisible(tester, find.textContaining(RegExp(r'Place order|Заказать')));

    // The live order screen.
    await waitFor(tester, find.byType(OrderStatusScreen), timeout: const Duration(seconds: 30));
    final orderId = tester.widget<OrderStatusScreen>(find.byType(OrderStatusScreen)).orderId;
    final order = await api(
      'GET',
      '/orders/$orderId',
      token: container.read(sessionManagerProvider).current!.accessToken,
    );
    final code = order['orderCode'] as String;
    await waitFor(tester, find.text(code));
    debugPrint('E2E: order $code placed');

    // A notifications prompt may appear after the first order; dismiss it.
    final close = find.textContaining(RegExp('^(Close|Закрыть)\$'));
    if (close.evaluate().isNotEmpty) {
      await tester.tap(close.first);
      await pumpFor(tester, const Duration(milliseconds: 600));
    }

    if (_staffEmail.isEmpty) return;

    // The kitchen takes it from here.
    final staff = await api('POST', '/auth/password/login', body: {'email': _staffEmail, 'password': _staffPassword});
    final staffToken = staff['accessToken'] as String;
    final storeId = order['storeId'] as String;
    Future<void> kds(String step) => api('POST', '/kds/orders/$orderId/$step?storeId=$storeId', token: staffToken);

    await kds('accept');
    await waitFor(tester, find.textContaining(RegExp('Accepted by the kitchen|Принят кухней')));
    debugPrint('E2E: accepted');
    await kds('start');
    await waitFor(tester, find.textContaining(RegExp('Preparing your order|Готовим ваш заказ')));
    debugPrint('E2E: preparing');
    await kds('ready');
    await waitFor(tester, find.textContaining(RegExp('Ready for pickup|Готов к выдаче')));
    debugPrint('E2E: ready');
    await kds('picked-up');
    await waitFor(tester, find.textContaining(RegExp('Enjoy!|Приятного аппетита!')));
    debugPrint('E2E: picked up');
    final again = find.textContaining(RegExp('Order again|Повторить заказ'));
    debugPrint('E2E: order-again buttons: ${again.evaluate().length}');
    expect(again, findsOneWidget);
    debugPrint('E2E: done');
  });
}
