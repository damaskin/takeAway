import 'dart:io';

import 'package:flutter/foundation.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:takeaway_mobile/app/app.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/core/auth/session_manager.dart';
import 'package:takeaway_mobile/features/menu/product_card.dart';
import 'package:takeaway_mobile/main.dart';

/// App Store screenshots from a real store, as a guest.
///
/// The test walks the screens and, at each stop, leaves `shot_<name>.ready`
/// in the app's tmp directory and waits for `shot_<name>.done`. A script on
/// the Mac (`scripts/app-store-screenshots.sh`) watches the simulator's app
/// container, takes `xcrun simctl io screenshot` — status bar included —
/// and answers with the `.done` file. Flutter's own screenshots would leave
/// the status bar out.
///
///   flutter test integration_test/app_store_screenshots_test.dart -d SIMULATOR_ID \
///     --dart-define-from-file=config/prod.json --dart-define=SHOT_STORE="NoName - центр"
const _storeName = String.fromEnvironment('SHOT_STORE', defaultValue: 'NoName - центр');
const _product = String.fromEnvironment('SHOT_PRODUCT', defaultValue: 'Айс Латте');

/// How far the menu is scrolled for its screenshot: past the first row, which
/// holds the store's own test items.
const _menuScroll = int.fromEnvironment('SHOT_MENU_SCROLL', defaultValue: 560);
const _category = String.fromEnvironment('SHOT_CATEGORY', defaultValue: 'Холодные напитки');

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  Future<void> pumpFor(WidgetTester tester, Duration total) async {
    final end = DateTime.now().add(total);
    while (DateTime.now().isBefore(end)) {
      await tester.pump(const Duration(milliseconds: 100));
    }
  }

  Future<void> waitFor(WidgetTester tester, Finder finder, {Duration timeout = const Duration(seconds: 30)}) async {
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
    await pumpFor(tester, const Duration(milliseconds: 800));
  }

  Future<void> shot(WidgetTester tester, String name) async {
    // Images come from the network; give them time to fade in.
    await pumpFor(tester, const Duration(seconds: 3));
    final tmp = Directory.systemTemp.path;
    final done = File('$tmp/shot_$name.done');
    if (done.existsSync()) done.deleteSync();
    File('$tmp/shot_$name.ready').writeAsStringSync(name);
    final end = DateTime.now().add(const Duration(seconds: 60));
    while (!done.existsSync()) {
      if (DateTime.now().isAfter(end)) throw TestFailure('Nobody took the screenshot "$name"');
      await tester.pump(const Duration(milliseconds: 200));
    }
    done.deleteSync();
    debugPrint('SHOT: $name');
  }

  testWidgets('App Store screenshots', (tester) async {
    final throttled = debugPrint;
    debugPrint = debugPrintSynchronously;
    addTearDown(() => debugPrint = throttled);

    // First launch: no session, no remembered store, intro not seen.
    SharedPreferences.setMockInitialValues({});
    await SecureSessionStorage().delete();
    final container = await bootstrap();
    await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const TakeAwayApp()));
    await pumpFor(tester, const Duration(seconds: 2));

    await shot(tester, '01_welcome');

    // Intro → skip. With several stores the menu asks for one first.
    await tapWhenVisible(tester, find.byType(TextButton));
    await pumpFor(tester, const Duration(seconds: 2));
    if (find.byType(ProductCard).evaluate().isEmpty && find.text(_storeName).evaluate().isNotEmpty) {
      await tapWhenVisible(tester, find.text(_storeName));
    }
    await waitFor(tester, find.byType(ProductCard));
    await pumpFor(tester, const Duration(seconds: 2));
    await tester.drag(find.byType(Scrollable).first, Offset(0, -_menuScroll.toDouble()));
    await shot(tester, '02_menu');

    // Another category, further down the menu.
    final category = find.text(_category);
    if (category.evaluate().isNotEmpty) {
      await tapWhenVisible(tester, category);
      await shot(tester, '03_category');
    }

    // A product with its options, from the category on screen.
    await tapWhenVisible(tester, find.text(_product));
    await waitFor(tester, find.byIcon(Icons.close_rounded));
    await shot(tester, '04_product');

    // Adding as a guest asks to sign in: Telegram, Google, Apple.
    await tapWhenVisible(tester, find.textContaining(RegExp('Add to cart|В корзину')));
    await waitFor(tester, find.textContaining(RegExp('Sign in to order|Войдите, чтобы заказать')));
    await shot(tester, '05_sign_in');

    // The stores tab.
    await tester.binding.handlePopRoute();
    await pumpFor(tester, const Duration(milliseconds: 800));
    await tester.binding.handlePopRoute();
    await pumpFor(tester, const Duration(milliseconds: 800));
    container.read(routerProvider).go(Routes.stores);
    await waitFor(tester, find.text(_storeName));
    await shot(tester, '06_stores');
  });
}
