import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/core/theme/app_theme.dart';
import 'package:takeaway_mobile/features/cart/cart_screen.dart';
import 'package:takeaway_mobile/shared/widgets/state_views.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

void main() {
  testWidgets('removing a line offers undo at once, and other notices wait for it instead of taking it away', (
    tester,
  ) async {
    final api = FakeApi()
      ..seedCart(FakeApi.croissant())
      ..removeDelay = const Duration(seconds: 2);
    final h = await pumpApp(tester, api: api);
    unawaited(h.container.read(routerProvider).push(Routes.cart));
    await settle(tester);

    await tester.drag(find.text('Круассан'), const Offset(-500, 0));
    await settle(tester, const Duration(milliseconds: 1000));
    expect(find.text('Вернуть'), findsOneWidget, reason: 'shown before the server has answered');
    expect(find.byIcon(Icons.close), findsOneWidget, reason: 'and closable by hand');

    // A foreground push or any other notice waits its turn.
    Snack.show(tester.element(find.byType(CartScreen)), 'Заказ #4821 готов');
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Вернуть'), findsOneWidget);
    expect(find.text('Заказ #4821 готов'), findsNothing);

    await tester.tap(find.text('Вернуть'));
    await settle(tester, const Duration(seconds: 1));
    expect(find.text('Вернуть'), findsNothing);
    expect(find.text('Заказ #4821 готов'), findsOneWidget, reason: 'the notice that waited shows next, not lost');

    await settle(tester, const Duration(seconds: 4));
    expect(api.added.single.productId, 'p_croissant', reason: 'undo puts the line back');
    await h.unmount(tester);
  });

  testWidgets('the undo offer goes away on its own after about three seconds', (tester) async {
    final api = FakeApi()..seedCart(FakeApi.croissant());
    final h = await pumpApp(tester, api: api);
    unawaited(h.container.read(routerProvider).push(Routes.cart));
    await settle(tester);

    await tester.drag(find.text('Круассан'), const Offset(-500, 0));
    await settle(tester);
    expect(find.text('Вернуть'), findsOneWidget);

    // Long enough to reach "Undo"...
    await settle(tester, const Duration(milliseconds: 1800));
    expect(find.text('Вернуть'), findsOneWidget);
    // ...but it does not hang over the cart.
    await settle(tester, const Duration(milliseconds: 1500));
    expect(find.text('Вернуть'), findsNothing);
    expect(api.added, isEmpty);
    await h.unmount(tester);
  });

  testWidgets('removing lines one after another replaces the undo offer instead of queueing them', (tester) async {
    final api = FakeApi()
      ..seedCart(FakeApi.latte())
      ..seedCart(FakeApi.croissant());
    final h = await pumpApp(tester, api: api);
    unawaited(h.container.read(routerProvider).push(Routes.cart));
    await settle(tester);

    await tester.drag(find.text('Латте'), const Offset(-500, 0));
    await settle(tester, const Duration(milliseconds: 600));
    expect(find.text('Латте удалено'), findsOneWidget);

    await tester.drag(find.text('Круассан'), const Offset(-500, 0));
    await settle(tester);
    expect(find.text('Круассан удалено'), findsOneWidget);
    expect(find.text('Латте удалено'), findsNothing);

    // Once the latest offer times out nothing else is left waiting.
    await settle(tester, const Duration(seconds: 4));
    expect(find.text('Вернуть'), findsNothing);
    expect(find.byType(SnackBar), findsNothing);
    await h.unmount(tester);
  });

  testWidgets('snacks shown in quick succession replace each other; none is left queued behind', (tester) async {
    final h = await pumpApp(tester);
    unawaited(h.container.read(routerProvider).push(Routes.cart));
    await settle(tester);
    final context = tester.element(find.byType(CartScreen));

    // Three lines removed faster than a snack slides out.
    for (final name in ['Латте', 'Капучино', 'Круассан']) {
      Snack.undo(context, '$name удалено', actionLabel: 'Вернуть', onUndo: () {});
      await tester.pump(const Duration(milliseconds: 50));
    }
    await settle(tester, const Duration(milliseconds: 800));
    expect(find.text('Круассан удалено'), findsOneWidget);
    await settle(tester, const Duration(seconds: 3));
    expect(find.byType(SnackBar), findsNothing, reason: 'the earlier offers do not follow one after another');

    Snack.show(context, 'Первое');
    await tester.pump(const Duration(milliseconds: 50));
    Snack.show(context, 'Второе');
    await settle(tester, const Duration(milliseconds: 800));
    expect(find.text('Второе'), findsOneWidget);
    await settle(tester, const Duration(seconds: 4));
    expect(find.text('Первое'), findsNothing);
    await h.unmount(tester);
  });

  test('the close button on a snack stands out from it in both themes', () {
    double luminance(Color c) => c.computeLuminance();
    double contrast(Color a, Color b) {
      final (hi, lo) = luminance(a) > luminance(b) ? (a, b) : (b, a);
      return (luminance(hi) + 0.05) / (luminance(lo) + 0.05);
    }

    AppTheme.useGoogleFonts = false;
    for (final theme in [AppTheme.light(), AppTheme.dark()]) {
      final snack = theme.snackBarTheme;
      expect(snack.closeIconColor, isNotNull, reason: 'Material falls back to onInverseSurface, near-black in dark');
      expect(
        contrast(snack.closeIconColor!, snack.backgroundColor!),
        greaterThan(4.5),
        reason: '${theme.brightness}: the close icon must be visible on the snack',
      );
    }
  });
}
