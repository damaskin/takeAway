import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/app/router.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

const _webFlow = FeatureFlags(agroprombankEnabled: true, cardPaymentFlow: CardPaymentFlow.web);

const _held = {'state': 'HELD', 'amountCents': 2000, 'cardMask': '•••• 1234', 'paidAt': null};
const _failed = {'state': 'FAILED', 'amountCents': 2000, 'cardMask': null, 'paidAt': null};

Future<void> _openCheckout(WidgetTester tester) async {
  await tester.tap(find.textContaining('позици'));
  await settle(tester);
  await tester.tap(find.textContaining('К оформлению'));
  await settle(tester);
}

Future<void> _openOrder(WidgetTester tester, Harness h) async {
  unawaited(h.container.read(routerProvider).push(Routes.order('ord_1')));
  await settle(tester);
}

void main() {
  testWidgets('checkout sends the customer to the bank page instead of picking a bound card', (tester) async {
    final api = FakeApi(flags: _webFlow)
      ..boundCards = [FakeApi.card()]
      ..seedCart(FakeApi.croissant());
    final h = await pumpApp(tester, api: api);
    await _openCheckout(tester);

    expect(find.textContaining('9104 **** **** 1234'), findsNothing, reason: 'no card picker in the web flow');
    expect(find.text('Привязать карту'), findsNothing);
    await tester.scrollUntilVisible(
      find.textContaining('на защищённой странице банка'),
      250,
      scrollable: find.byType(Scrollable).first,
    );

    await tester.tap(find.textContaining('Оплатить'));
    await settle(tester, const Duration(seconds: 2));

    expect(api.created, hasLength(1));
    expect(api.paid, isEmpty, reason: 'no bound card is charged');
    expect(api.webPayments.single.toJson(), {'orderId': 'ord_1', 'returnTo': 'mobile'});
    expect(h.webPayments.opened, [Uri.parse(FakeApi.webPaymentUrl)]);
    expect(find.text('Заказ #4821'), findsOneWidget, reason: 'the order screen waits under the bank page');

    // The bank sends the customer back; the amount is now held.
    api.currentOrder = FakeApi.sampleOrder(payment: _held);
    h.webPayments.deliver(Uri.parse('takeaway://pay?orderId=ord_1&status=success'));
    await settle(tester);

    expect(h.webPayments.closed, 1, reason: 'the in-app browser is dismissed');
    expect(
      find.text('Заказ #4821', skipOffstage: false),
      findsOneWidget,
      reason: 'the order already on screen is refreshed, not pushed again',
    );
    expect(find.text('Сумма забронирована'), findsOneWidget);
    expect(find.byKey(const ValueKey('pay')), findsNothing, reason: 'nothing left to pay');
    expect(find.text('Я на месте'), findsOneWidget);
    await h.unmount(tester);
  });

  testWidgets('a failed web payment can be paid again from the order screen', (tester) async {
    final api = FakeApi(flags: _webFlow)..currentOrder = FakeApi.sampleOrder(payment: _failed);
    final h = await pumpApp(tester, api: api);
    await _openOrder(tester, h);

    expect(find.text('Оплата не прошла'), findsOneWidget);
    await tester.tap(find.byKey(const ValueKey('pay')));
    await settle(tester);

    expect(api.webPayments.single.orderId, 'ord_1');
    expect(h.webPayments.opened, hasLength(1));
    await h.unmount(tester);
  });

  testWidgets('the return link opens the order from anywhere in the app and says when payment failed', (tester) async {
    final api = FakeApi(flags: _webFlow)..currentOrder = FakeApi.sampleOrder(payment: _failed);
    final h = await pumpApp(tester, api: api);

    h.webPayments.deliver(Uri.parse('takeaway://pay?orderId=ord_1&status=fail'));
    await settle(tester);

    expect(find.text('Заказ #4821'), findsOneWidget);
    expect(find.text('Оплата не прошла. Можно попробовать ещё раз.'), findsOneWidget);
    expect(find.byKey(const ValueKey('pay')), findsOneWidget);
    await h.unmount(tester);
  });

  testWidgets('the bound-card flow keeps the retry off the order screen', (tester) async {
    final api = FakeApi(flags: const FeatureFlags(agroprombankEnabled: true))
      ..currentOrder = FakeApi.sampleOrder(payment: _failed);
    final h = await pumpApp(tester, api: api);
    await _openOrder(tester, h);

    expect(find.byKey(const ValueKey('pay')), findsNothing);
    await h.unmount(tester);
  });
}
