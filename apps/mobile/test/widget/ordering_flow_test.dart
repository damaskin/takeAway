import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/core/format/time.dart';
import 'package:takeaway_mobile/features/auth/sign_in_sheet.dart';
import 'package:takeaway_mobile/features/checkout/checkout_sections.dart';
import 'package:takeaway_mobile/features/menu/product_card.dart';
import 'package:takeaway_mobile/shared/widgets/chips.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

void main() {
  testWidgets('menu shows the store, categories and prices in the store currency', (tester) async {
    final h = await pumpApp(tester);

    expect(find.textContaining('Иван'), findsWidgets, reason: 'greeting uses the first name');
    expect(find.text('NoName — центр'), findsOneWidget);
    expect(find.text('Кофе'), findsWidgets);
    expect(find.text('Латте'), findsOneWidget);
    expect(find.text('20 MDL'), findsOneWidget);
    expect(find.textContaining(r'$'), findsNothing, reason: 'no dollar prices for an MDL store');

    await h.unmount(tester);
  });

  testWidgets('customising a latte updates the price and sends the chosen options to the cart', (tester) async {
    final h = await pumpApp(tester);

    await tester.tap(find.text('Латте'));
    await settle(tester);

    expect(find.text('Размер'), findsOneWidget);
    expect(find.text('20 MDL'), findsWidgets);

    await tester.ensureVisible(find.text('Овсяное'));
    await settle(tester, const Duration(milliseconds: 300));
    await tester.tap(find.text('M'));
    await tester.tap(find.text('Овсяное'));
    await settle(tester, const Duration(milliseconds: 600));
    // 20 + 5 (M) + 8 (oat milk)
    expect(find.text('33 MDL'), findsOneWidget);

    await tester.tap(find.text('В корзину'));
    await settle(tester);

    final sent = h.api.added.single;
    expect(sent.productId, 'p_latte');
    expect(sent.variationIds, containsAll(<String>['v_m', 'v_oat']));
    expect(sent.quantity, 1);

    // Back on the menu the cart bar acknowledges the add — no snackbar over
    // it — then settles into the summary.
    expect(find.text('Латте в корзине'), findsOneWidget);
    expect(find.byType(SnackBar), findsNothing);
    await settle(tester, const Duration(seconds: 3));
    expect(find.textContaining('1 позиция'), findsOneWidget);
    await h.unmount(tester);
  });

  Finder addButtonOf(String product) => find.descendant(
    of: find.ancestor(of: find.text(product), matching: find.byType(ProductCard)),
    matching: find.byIcon(Icons.add_rounded),
  );

  /// Brings a product card into the middle of the menu, clear of the tab bar.
  Future<void> scrollMenuTo(WidgetTester tester, String product) async {
    await tester.dragUntilVisible(find.text(product), find.byType(CustomScrollView).first, const Offset(0, -150));
    await tester.drag(find.byType(CustomScrollView).first, const Offset(0, -250));
    await settle(tester, const Duration(milliseconds: 500));
  }

  testWidgets('quick add puts an item without options straight into the cart', (tester) async {
    final h = await pumpApp(tester);

    await scrollMenuTo(tester, 'Круассан');
    await tester.tap(addButtonOf('Круассан'));
    await settle(tester);

    expect(h.api.added.single.productId, 'p_croissant');
    expect(find.text('Круассан в корзине'), findsOneWidget);
    expect(find.byType(SnackBar), findsNothing, reason: 'a snackbar would cover the cart bar');
    await h.unmount(tester);
  });

  testWidgets('a guest adding to the cart is asked to sign in first', (tester) async {
    final h = await pumpApp(tester, signedIn: false);

    await scrollMenuTo(tester, 'Круассан');
    await tester.tap(addButtonOf('Круассан'));
    await settle(tester);

    expect(find.byType(SignInSheet), findsOneWidget);
    expect(h.api.added, isEmpty);
    await h.unmount(tester);
  });

  testWidgets('after hours the store reads as closed and checkout only takes a scheduled pickup', (tester) async {
    final api = FakeApi()
      ..storeOpenNow = false
      ..seedCart(FakeApi.croissant());
    final h = await pumpApp(tester, api: api);

    expect(find.text('Сейчас закрыто — можно оформить заказ на более позднее время.'), findsOneWidget);
    expect(find.byType(EtaChip), findsNothing, reason: 'no ETA promised for a closed store');
    expect(find.text('Закрыто'), findsOneWidget);

    await tester.tap(find.textContaining('1 позиция'));
    await settle(tester);
    await tester.tap(find.textContaining('К оформлению'));
    await settle(tester);

    // Starts on "later", and "as soon as possible" does not respond.
    expect(find.text('Выберите время'), findsNothing);
    await tester.tap(find.text('Как можно скорее'));
    await settle(tester);
    await tester.tap(find.textContaining('Заказать ·'));
    await settle(tester);
    expect(h.api.created, isEmpty, reason: 'no ASAP order goes out after hours');
    expect(find.text('Выберите время'), findsOneWidget);

    await h.unmount(tester);
  });

  testWidgets('checkout places an ASAP order and opens the live order screen', (tester) async {
    final api = FakeApi()..seedCart(FakeApi.croissant(), quantity: 2);
    final h = await pumpApp(tester, api: api);

    await tester.tap(find.textContaining('2 позиции'));
    await settle(tester);
    expect(find.text('Ваш заказ'), findsOneWidget);
    expect(find.text('30 MDL'), findsWidgets);

    await tester.tap(find.textContaining('К оформлению'));
    await settle(tester);
    expect(find.text('Оформление'), findsOneWidget);
    expect(find.text('Оплата на месте'), findsWidgets);

    await tester.tap(find.textContaining('Заказать ·'));
    await settle(tester, const Duration(seconds: 2));

    final order = h.api.created.single;
    expect(order.cartId, 'cart_1');
    expect(order.pickupMode, PickupMode.asap);
    expect(order.customerName, 'Иван Дамаскин', reason: 'contact is prefilled from the profile');
    expect(h.api.paid, isEmpty, reason: 'paying at the counter charges nothing');

    expect(find.text('Заказ #4821'), findsOneWidget);
    expect(find.text('4821'), findsWidgets);
    expect(find.text('Заказ получен'), findsOneWidget);
    await h.unmount(tester);
  });

  testWidgets('scheduled checkout needs a slot and sends it', (tester) async {
    final api = FakeApi()..seedCart(FakeApi.croissant());
    final h = await pumpApp(tester, api: api);

    await tester.tap(find.textContaining('1 позиция'));
    await settle(tester);
    await tester.tap(find.textContaining('К оформлению'));
    await settle(tester);

    await tester.tap(find.text('Позже'));
    await settle(tester);

    final slots = await api.pickupSlots('st_1');
    // The first free window is the first chip; tap it by its time label,
    // formatted the way the app formats it ("0:30" in Russian, not "00:30").
    final label = formatClock(tester.element(find.byType(SlotPicker)), slots.first.startsAt);
    await tester.tap(find.textContaining(label).first);
    await settle(tester);

    await tester.tap(find.textContaining('Заказать ·'));
    await settle(tester, const Duration(seconds: 2));

    final order = h.api.created.single;
    expect(order.pickupMode, PickupMode.scheduled);
    expect(order.pickupAt, slots.first.startsAt);
    await h.unmount(tester);
  });
}
