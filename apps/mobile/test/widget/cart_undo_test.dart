import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/features/cart/cart_screen.dart';
import 'package:takeaway_mobile/shared/widgets/state_views.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

void main() {
  testWidgets('removing a line offers undo at once, and other notices do not take it away', (tester) async {
    final api = FakeApi()
      ..seedCart(FakeApi.croissant())
      ..removeDelay = const Duration(seconds: 2);
    final h = await pumpApp(tester, api: api);
    unawaited(h.container.read(routerProvider).push(Routes.cart));
    await settle(tester);

    await tester.drag(find.text('Круассан'), const Offset(-500, 0));
    await settle(tester, const Duration(milliseconds: 1000));
    expect(find.text('Вернуть'), findsOneWidget, reason: 'shown before the server has answered');

    // A foreground push or any other notice waits its turn.
    Snack.show(tester.element(find.byType(CartScreen)), 'Заказ #4821 готов');
    await tester.pump(const Duration(milliseconds: 400));
    expect(find.text('Вернуть'), findsOneWidget);
    expect(find.text('Заказ #4821 готов'), findsNothing);

    // Still there past the old three seconds, and closable by hand.
    await settle(tester, const Duration(seconds: 3));
    expect(find.text('Вернуть'), findsOneWidget);
    expect(find.byIcon(Icons.close), findsOneWidget);

    await tester.tap(find.text('Вернуть'));
    await settle(tester, const Duration(seconds: 3));
    expect(api.added.single.productId, 'p_croissant', reason: 'undo puts the line back');
    expect(find.text('Вернуть'), findsNothing);

    await settle(tester, const Duration(seconds: 4));
    await h.unmount(tester);
  });

  testWidgets('the undo offer times out on its own', (tester) async {
    final api = FakeApi()..seedCart(FakeApi.croissant());
    final h = await pumpApp(tester, api: api);
    unawaited(h.container.read(routerProvider).push(Routes.cart));
    await settle(tester);

    await tester.drag(find.text('Круассан'), const Offset(-500, 0));
    await settle(tester);
    expect(find.text('Вернуть'), findsOneWidget);

    await settle(tester, const Duration(seconds: 6));
    expect(find.text('Вернуть'), findsNothing);
    expect(api.added, isEmpty);
    await h.unmount(tester);
  });
}
