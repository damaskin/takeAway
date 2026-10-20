import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/core/format/time.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

Future<void> openOrder(WidgetTester tester, Harness h) async {
  unawaited(h.container.read(routerProvider).push(Routes.order('ord_1')));
  await settle(tester);
}

/// Scrolls a lazily built list until [finder] exists, then brings it fully
/// on screen so a tap lands on it rather than on whatever overlaps the edge.
Future<void> reveal(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(finder, 250, scrollable: find.byType(Scrollable).first);
  await tester.ensureVisible(finder);
  await settle(tester, const Duration(milliseconds: 400));
}

Future<void> openCheckout(WidgetTester tester) async {
  await tester.tap(find.textContaining('позици'));
  await settle(tester);
  await tester.tap(find.textContaining('К оформлению'));
  await settle(tester);
}

void main() {
  group('order screen', () {
    testWidgets('shows the pickup code, where the money stands and lets the customer cancel', (tester) async {
      final api = FakeApi()..currentOrder = FakeApi.sampleOrder();
      final h = await pumpApp(tester, api: api);
      await openOrder(tester, h);

      expect(find.text('Заказ #4821'), findsOneWidget);
      expect(find.text('Заказ получен'), findsOneWidget);
      expect(find.text('Ждём оплату'), findsOneWidget, reason: 'a new order with no card on it yet is unpaid');
      expect(find.text('Я на месте'), findsOneWidget);

      // The code is what the counter hands the order over by; nobody scans a QR.
      final code = find.byKey(const ValueKey('pickup-code'));
      await reveal(tester, code);
      expect(find.descendant(of: code, matching: find.text('Ваш код')), findsOneWidget);
      expect(find.descendant(of: code, matching: find.text('4821')), findsOneWidget);
      expect(find.descendant(of: code, matching: find.text('Покажите его на выдаче')), findsOneWidget);
      expect(find.text('Показать QR'), findsNothing);

      await reveal(tester, find.text('Отменить заказ'));
      await tester.tap(find.text('Отменить заказ'));
      await settle(tester);
      expect(find.text('Отменить заказ?'), findsOneWidget);
      expect(
        find.text('Точка ещё не приняла заказ, деньги не списаны. Если сумма забронирована на карте, бронь снимется.'),
        findsOneWidget,
      );
      await tester.tap(find.widgetWithText(TextButton, 'Отменить заказ'));
      await settle(tester);

      expect(api.cancelled, ['ord_1']);
      expect(find.text('Отменён'), findsWidgets);
      expect(find.text('Повторить заказ'), findsOneWidget, reason: 'a finished order offers to order again');
      await h.unmount(tester);
    });

    testWidgets('once the kitchen accepted the order the customer calls the store to cancel it', (tester) async {
      final api = FakeApi()
        ..storeExtra = {'acceptingOrders': true, 'phone': '+373 69 123 456'}
        ..currentOrder = FakeApi.sampleOrder(status: 'ACCEPTED', canCancel: false);
      final h = await pumpApp(tester, api: api);
      await openOrder(tester, h);

      final note = find.byKey(const ValueKey('cancel-by-phone'));
      await reveal(tester, note);
      expect(find.text('Заказ уже готовят — для отмены позвоните в точку'), findsOneWidget);
      expect(find.descendant(of: note, matching: find.byIcon(Icons.call_rounded)), findsOneWidget);
      expect(find.text('Отменить заказ'), findsNothing);
      await h.unmount(tester);
    });

    testWidgets('an older API without canCancel: no cancel once accepted, and no call without a phone', (tester) async {
      final api = FakeApi()..currentOrder = FakeApi.sampleOrder(status: 'IN_PROGRESS');
      final h = await pumpApp(tester, api: api);
      await openOrder(tester, h);

      final note = find.byKey(const ValueKey('cancel-by-phone'));
      await reveal(tester, note);
      expect(find.text('Отменить заказ'), findsNothing);
      expect(find.descendant(of: note, matching: find.byIcon(Icons.call_rounded)), findsNothing);
      await h.unmount(tester);
    });

    testWidgets('money already taken before the accept: the API says no, so no cancel button', (tester) async {
      final api = FakeApi()
        ..currentOrder = FakeApi.sampleOrder(
          status: 'PAID',
          canCancel: false,
          payment: {'state': 'PAID', 'amountCents': 2000, 'cardMask': null, 'paidAt': null},
        );
      final h = await pumpApp(tester, api: api);
      await openOrder(tester, h);

      await reveal(tester, find.byKey(const ValueKey('cancel-by-phone')));
      expect(find.text('Отменить заказ'), findsNothing);
      await h.unmount(tester);
    });

    testWidgets('a cancel the kitchen beat by a moment shows the order as it is and says why', (tester) async {
      final api = FakeApi()
        ..currentOrder = FakeApi.sampleOrder(
          canCancel: true,
          payment: {'state': 'HELD', 'amountCents': 2000, 'cardMask': null, 'paidAt': null},
        )
        ..acceptedBeforeCancel = FakeApi.sampleOrder(
          status: 'ACCEPTED',
          canCancel: false,
          payment: {'state': 'PAID', 'amountCents': 2000, 'cardMask': null, 'paidAt': null},
        );
      final h = await pumpApp(tester, api: api);
      await openOrder(tester, h);

      await reveal(tester, find.text('Отменить заказ'));
      await tester.tap(find.text('Отменить заказ'));
      await settle(tester);
      await tester.tap(find.widgetWithText(TextButton, 'Отменить заказ'));
      await settle(tester);

      expect(api.cancelled, isEmpty);
      expect(find.text('Принят кухней'), findsOneWidget, reason: 'the order was read again');
      expect(find.text('Отменить заказ'), findsNothing);
      // Once in the snack bar, once in place of the button.
      expect(find.text('Заказ уже готовят — для отмены позвоните в точку'), findsNWidgets(2));
      await h.unmount(tester);
    });

    testWidgets('an order the kitchen took late counts down to its new estimate instead of reading as late', (
      tester,
    ) async {
      final estimate = DateTime.now().add(const Duration(minutes: 8));
      final api = FakeApi()
        ..storeExtra = {'acceptingOrders': true}
        ..currentOrder = FakeApi.sampleOrder(
          status: 'IN_PROGRESS',
          pickupAt: DateTime.now().subtract(const Duration(minutes: 3)),
          readyEstimateAt: estimate,
        );
      final h = await pumpApp(tester, api: api);
      await openOrder(tester, h);

      expect(find.text('Готовим · будет готово через 8 мин'), findsOneWidget);
      expect(find.text('Немного задерживаемся'), findsNothing);
      expect(find.textContaining(RegExp(r'^7:\d\d$')), findsOneWidget, reason: 'the ring counts down to the estimate');
      final context = tester.element(find.byType(Scaffold).last);
      expect(find.text('Забрать в ${formatClock(context, estimate)}'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('moves on a live status event without a reload', (tester) async {
      final api = FakeApi()..currentOrder = FakeApi.sampleOrder(status: 'ACCEPTED');
      final h = await pumpApp(tester, api: api);
      await openOrder(tester, h);
      expect(find.text('Принят кухней'), findsOneWidget);

      api.currentOrder = FakeApi.sampleOrder(status: 'READY');
      h.realtime.emit(const OrderStatusEvent(orderId: 'ord_1', status: OrderStatus.ready, etaSeconds: 0));
      await settle(tester);

      // The headline is the product's promise: ready, and no queue.
      expect(find.text('Ваш заказ готов'), findsOneWidget);
      expect(find.text('Вы простояли в очереди 0 минут. Наслаждайтесь!'), findsOneWidget);
      expect(find.text('Готово'), findsWidgets, reason: 'the ring switches from countdown to ready');

      api.currentOrder = FakeApi.sampleOrder(status: 'PICKED_UP');
      h.realtime.emit(const OrderStatusEvent(orderId: 'ord_1', status: OrderStatus.pickedUp, etaSeconds: 0));
      await settle(tester);
      // Neutral: the app does not know whether it was a coffee or a meal.
      expect(find.text('Заказ выдан'), findsOneWidget);
      expect(find.text('Ни минуты в очереди — так и задумано. Хорошего дня!'), findsOneWidget);
      expect(find.textContaining('аппетит'), findsNothing);
      await h.unmount(tester);
    });

    testWidgets('explains a held card payment', (tester) async {
      final api = FakeApi()
        ..currentOrder = FakeApi.sampleOrder(
          payment: {'state': 'HELD', 'amountCents': 2000, 'cardMask': '9104 **** 1234', 'paidAt': null},
        );
      final h = await pumpApp(tester, api: api);
      await openOrder(tester, h);

      expect(find.text('Спишем при принятии заказа'), findsOneWidget);
      expect(find.textContaining('9104 **** 1234'), findsOneWidget);
      expect(find.text('Если точка не примет заказ, деньги с карты не спишутся.'), findsOneWidget);
      await h.unmount(tester);
    });
  });

  group('card payment', () {
    testWidgets('charges the default card once the order exists', (tester) async {
      final api = FakeApi(flags: const FeatureFlags(agroprombankEnabled: true))
        ..boundCards = [FakeApi.card()]
        ..seedCart(FakeApi.croissant());
      final h = await pumpApp(tester, api: api);
      await openCheckout(tester);

      expect(find.textContaining('9104 **** **** 1234'), findsOneWidget);
      expect(find.textContaining('Оплатить'), findsOneWidget);

      await tester.tap(find.textContaining('Оплатить'));
      await settle(tester, const Duration(seconds: 2));

      expect(api.created, hasLength(1));
      expect(api.paid.single, {'orderId': 'ord_1', 'cardId': 'card_1'});
      expect(find.text('Заказ #4821'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('a declined card keeps the customer on checkout and retries without a second order', (tester) async {
      final api = FakeApi(flags: const FeatureFlags(agroprombankEnabled: true))
        ..boundCards = [FakeApi.card()]
        ..declineWith = 'Недостаточно средств'
        ..seedCart(FakeApi.croissant());
      final h = await pumpApp(tester, api: api);
      await openCheckout(tester);

      await tester.tap(find.textContaining('Оплатить'));
      await settle(tester, const Duration(seconds: 2));

      expect(find.text('Недостаточно средств'), findsOneWidget, reason: 'the bank’s reason is shown');
      expect(find.text('Оплатить снова'), findsOneWidget);
      expect(find.text('Оформление'), findsOneWidget);

      await tester.tap(find.text('Оплатить снова'));
      await settle(tester, const Duration(seconds: 2));

      expect(api.created, hasLength(1), reason: 'the retry charges the same order');
      expect(api.paid, hasLength(2));
      expect(find.text('Заказ #4821'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('there is no paying at the counter: without a card the order cannot be placed', (tester) async {
      final api = FakeApi(flags: const FeatureFlags(agroprombankEnabled: true))..seedCart(FakeApi.croissant());
      final h = await pumpApp(tester, api: api);
      await openCheckout(tester);

      expect(find.text('Оплата на месте'), findsNothing);
      await reveal(tester, find.text('Заказы оплачиваются картой. Привяжите карту, чтобы оформить заказ.'));
      expect(find.text('Привязать карту'), findsOneWidget);

      await tester.tap(find.textContaining('Оплатить'), warnIfMissed: false);
      await settle(tester, const Duration(seconds: 1));

      expect(api.created, isEmpty, reason: 'the button stays off until a card is bound');
      await h.unmount(tester);
    });

    testWidgets('with card payments switched off the customer is told why nothing can be ordered', (tester) async {
      final api = FakeApi()..seedCart(FakeApi.croissant());
      final h = await pumpApp(tester, api: api);
      await openCheckout(tester);

      await reveal(tester, find.textContaining('Оплата картой сейчас недоступна'));
      await tester.tap(find.textContaining('Оплатить'), warnIfMissed: false);
      await settle(tester, const Duration(seconds: 1));

      expect(api.created, isEmpty);
      await h.unmount(tester);
    });
  });
}
