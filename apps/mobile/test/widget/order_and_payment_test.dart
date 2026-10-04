import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/app/router.dart';

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
      expect(find.text('4821'), findsWidgets);
      expect(find.text('Заказ получен'), findsOneWidget);
      expect(find.text('Ждём оплату'), findsOneWidget, reason: 'a new order with no card on it yet is unpaid');
      expect(find.text('Я на месте'), findsOneWidget);

      await reveal(tester, find.text('Отменить заказ'));
      await tester.tap(find.text('Отменить заказ'));
      await settle(tester);
      expect(find.text('Отменить заказ?'), findsOneWidget);
      await tester.tap(find.widgetWithText(TextButton, 'Отменить заказ'));
      await settle(tester);

      expect(api.cancelled, ['ord_1']);
      expect(find.text('Отменён'), findsWidgets);
      expect(find.text('Повторить заказ'), findsOneWidget, reason: 'a finished order offers to order again');
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
      expect(find.text('Приятного аппетита!'), findsOneWidget);
      expect(find.text('Ни минуты в очереди — так и задумано. Хорошего дня!'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('explains a held card payment', (tester) async {
      final api = FakeApi()
        ..currentOrder = FakeApi.sampleOrder(
          payment: {'state': 'HELD', 'amountCents': 2000, 'cardMask': '9104 **** 1234', 'paidAt': null},
        );
      final h = await pumpApp(tester, api: api);
      await openOrder(tester, h);

      expect(find.text('Сумма забронирована'), findsOneWidget);
      expect(find.textContaining('9104 **** 1234'), findsOneWidget);
      expect(find.text('Спишем, когда точка примет заказ.'), findsOneWidget);
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
