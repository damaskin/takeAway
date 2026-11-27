import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/features/orders/order_progress.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

// Since 2026-11-27 a brand takes online payment only at its own terminal; a
// store whose brand has none sends `onlinePayment: {card: false, qr: false}`
// and its orders go to the kitchen at once, paid at the store
// (`payAtCounter`). An API that predates it sends no `onlinePayment`.

/// Cards on the bank's page and QR in the bank's app, both on.
const _webAndQr = FeatureFlags(
  agroprombankEnabled: true,
  cardPaymentFlow: CardPaymentFlow.web,
  qrPaymentCurrencies: ['RUP'],
);

/// Cards on the bank's page only.
const _web = FeatureFlags(agroprombankEnabled: true, cardPaymentFlow: CardPaymentFlow.web);

/// Cards off: QR is the only way to pay.
const _qrOnly = FeatureFlags(cardPaymentFlow: CardPaymentFlow.none, qrPaymentCurrencies: ['RUP']);

const _held = {'state': 'HELD', 'amountCents': 2000, 'cardMask': null, 'paidAt': null};

const _notice = 'Оплата на месте. Заказ сразу уйдёт в кофейню — оплатите при получении.';
const _unavailable = 'Онлайн-оплата в этой кофейне недоступна — оплатите на месте';

/// A store selling in [currency]; [online] is what it says about online
/// payment, left out as by an older API when null.
FakeApi _store(FeatureFlags flags, {Map<String, Object>? online, String currency = 'RUP'}) => FakeApi(flags: flags)
  ..storeExtra = {'currency': currency, 'onlinePayment': ?online}
  ..orderCurrency = currency;

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

Future<void> _reveal(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(finder, 250, scrollable: find.byType(Scrollable).first);
  await tester.ensureVisible(finder);
  await settle(tester, const Duration(milliseconds: 400));
}

Finder _step(String label) => find.descendant(of: find.byType(OrderStepper), matching: find.text(label));

Finder _inPaymentLine(String text) =>
    find.descendant(of: find.byKey(const ValueKey('payment-line')), matching: find.text(text));

final _code = find.byKey(const ValueKey('pickup-code'));
final _payByCard = find.byKey(const ValueKey('pay'));
final _payByQr = find.byKey(const ValueKey('pay-qr'));

void main() {
  group('checkout', () {
    testWidgets('a store that takes no online payment: a notice instead of the payment, no payment step', (
      tester,
    ) async {
      final api = _store(_webAndQr, online: {'card': false, 'qr': false})
        ..orderPayAtCounter = true
        ..seedCart(FakeApi.croissant());
      final h = await pumpApp(tester, api: api);
      await _openCheckout(tester);

      await _reveal(tester, find.byKey(const ValueKey('pay-at-counter')));
      expect(find.text(_notice), findsOneWidget);
      expect(find.byKey(const ValueKey('pay-method-card')), findsNothing);
      expect(find.byKey(const ValueKey('pay-method-qr')), findsNothing);
      expect(find.textContaining('на защищённой странице банка'), findsNothing);
      expect(find.textContaining('Покажем QR-код'), findsNothing);
      expect(find.textContaining('Оплата картой сейчас недоступна'), findsNothing);
      expect(find.textContaining('Оплатить'), findsNothing, reason: 'nothing is paid here');

      await tester.tap(find.text('Заказать · 15 руб.'));
      await settle(tester, const Duration(seconds: 2));

      expect(api.created, hasLength(1));
      expect(api.webPayments, isEmpty);
      expect(h.webPayments.opened, isEmpty);
      expect(api.qrStarts, isEmpty);
      expect(api.paid, isEmpty);
      expect(find.text('Заказ #4821'), findsOneWidget, reason: 'straight to the order');
      expect(find.text(_unavailable), findsNothing, reason: 'checkout said so already');
      expect(_step('Оплата на месте'), findsOneWidget);
      expect(_payByCard, findsNothing);
      expect(_payByQr, findsNothing);
      await h.unmount(tester);
    });

    testWidgets('a brand that takes QR only: no card to choose, the order is paid by QR', (tester) async {
      final api = _store(_webAndQr, online: {'card': false, 'qr': true})..seedCart(FakeApi.croissant());
      final h = await pumpApp(tester, api: api);
      await _openCheckout(tester);

      await _reveal(tester, find.textContaining('Покажем QR-код'));
      expect(find.byKey(const ValueKey('pay-method-card')), findsNothing, reason: 'nothing to choose from');
      expect(find.byKey(const ValueKey('pay-method-qr')), findsNothing);
      expect(find.textContaining('на защищённой странице банка'), findsNothing);
      expect(find.byKey(const ValueKey('pay-at-counter')), findsNothing);

      await tester.tap(find.textContaining('Оплатить'));
      await settle(tester, const Duration(seconds: 2));
      expect(api.qrStarts, ['ord_1']);
      expect(api.webPayments, isEmpty);
      expect(find.byType(QrImageView), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('a brand without a QR section: card only, even where QR would work', (tester) async {
      final api = _store(_webAndQr, online: {'card': true, 'qr': false})..seedCart(FakeApi.croissant());
      final h = await pumpApp(tester, api: api, saved: {'checkout.payMethod': 'qr'});
      await _openCheckout(tester);

      await _reveal(tester, find.textContaining('на защищённой странице банка'));
      expect(find.byKey(const ValueKey('pay-method-qr')), findsNothing);
      expect(find.textContaining('Покажем QR-код'), findsNothing, reason: 'the last QR choice does not apply here');

      await tester.tap(find.textContaining('Оплатить'));
      await settle(tester, const Duration(seconds: 2));
      expect(api.webPayments.single.orderId, 'ord_1');
      expect(api.qrStarts, isEmpty);
      await h.unmount(tester);
    });

    testWidgets('an API that does not say keeps checkout as it was: the flags decide', (tester) async {
      final api = _store(_webAndQr)..seedCart(FakeApi.croissant());
      final h = await pumpApp(tester, api: api);
      await _openCheckout(tester);

      await _reveal(tester, find.byKey(const ValueKey('pay-method-qr')));
      expect(find.byKey(const ValueKey('pay-method-card')), findsOneWidget);
      expect(find.byKey(const ValueKey('pay-at-counter')), findsNothing);
      expect(find.text(_notice), findsNothing);
      await h.unmount(tester);
    });

    testWidgets('the API placed the order as paid at the store: no payment, a word about it, the order opens', (
      tester,
    ) async {
      final api = _store(_web, online: {'card': true, 'qr': false}, currency: 'MDL')
        ..orderPayAtCounter = true
        ..seedCart(FakeApi.croissant());
      final h = await pumpApp(tester, api: api);
      await _openCheckout(tester);

      await tester.tap(find.textContaining('Оплатить'));
      await settle(tester, const Duration(seconds: 2));

      expect(api.created, hasLength(1));
      expect(api.webPayments, isEmpty, reason: 'nothing to pay online');
      expect(h.webPayments.opened, isEmpty);
      expect(find.text('Заказ #4821'), findsOneWidget);
      expect(find.text(_unavailable), findsOneWidget);
      expect(_step('Оплата на месте'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('a card payment refused as unavailable opens the order instead of a dead end', (tester) async {
      final api = FakeApi(flags: _web)
        ..webPaymentFailure = (409, {'code': 'ONLINE_PAYMENT_UNAVAILABLE', 'message': 'No terminal'})
        ..seedCart(FakeApi.croissant());
      final h = await pumpApp(tester, api: api);
      await _openCheckout(tester);

      await tester.tap(find.textContaining('Оплатить'));
      await settle(tester, const Duration(seconds: 2));

      expect(api.created, hasLength(1));
      expect(api.webPayments, hasLength(1));
      expect(h.webPayments.opened, isEmpty);
      expect(find.text('Оплатить снова'), findsNothing);
      expect(find.text('Оформление'), findsNothing);
      expect(find.text('Заказ #4821'), findsOneWidget);
      expect(find.text(_unavailable), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('a QR payment refused as unavailable opens the order too', (tester) async {
      final api = _store(_qrOnly)
        ..qrStartFailure = (409, {'code': 'QR_PAYMENT_DISABLED', 'message': 'No QR terminal'})
        ..seedCart(FakeApi.croissant());
      final h = await pumpApp(tester, api: api);
      await _openCheckout(tester);

      await tester.tap(find.textContaining('Оплатить'));
      await settle(tester, const Duration(seconds: 2));

      expect(api.created, hasLength(1));
      expect(api.qrStarts, ['ord_1']);
      expect(find.byType(QrImageView), findsNothing);
      expect(find.text('Заказ #4821'), findsOneWidget);
      expect(find.text(_unavailable), findsOneWidget);
      await h.unmount(tester);
    });
  });

  group('order screen', () {
    testWidgets('an order waiting for its online payment: «Ждём оплату» first, no pickup code', (tester) async {
      final api = FakeApi(flags: _web)..currentOrder = FakeApi.sampleOrder();
      final h = await pumpApp(tester, api: api);
      await _openOrder(tester, h);

      expect(_step('Ждём оплату'), findsOneWidget);
      expect(_step('Принят'), findsNothing);
      expect(find.descendant(of: find.byType(OrderStepper), matching: find.byIcon(Icons.check_rounded)), findsNothing);
      expect(_payByCard, findsOneWidget);
      await _reveal(tester, find.byKey(const ValueKey('payment-line')));
      expect(_inPaymentLine('Ждём оплату'), findsOneWidget);
      expect(_code, findsNothing, reason: 'the kitchen does not see the order yet');
      await h.unmount(tester);
    });

    testWidgets('once the payment is held: «Принят» and the pickup code, as before', (tester) async {
      final api = FakeApi(flags: _web)..currentOrder = FakeApi.sampleOrder(payment: _held);
      final h = await pumpApp(tester, api: api);
      await _openOrder(tester, h);

      expect(_step('Принят'), findsOneWidget);
      expect(_step('Ждём оплату'), findsNothing);
      expect(_payByCard, findsNothing);
      await _reveal(tester, _code);
      expect(find.descendant(of: _code, matching: find.text('4821')), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('an order paid at the store: «Оплата на месте» done from the start, never a payment', (tester) async {
      final api = _store(_webAndQr)..currentOrder = FakeApi.sampleOrder(currency: 'RUP', payAtCounter: true);
      final h = await pumpApp(tester, api: api);
      await _openOrder(tester, h);

      expect(_step('Оплата на месте'), findsOneWidget);
      expect(_step('Ждём оплату'), findsNothing);
      expect(
        find.descendant(of: find.byType(OrderStepper), matching: find.byIcon(Icons.check_rounded)),
        findsOneWidget,
        reason: 'ticked from placement',
      );
      expect(find.text('Ждём подтверждения точки'), findsOneWidget, reason: 'on the kitchen board already');
      expect(_payByCard, findsNothing);
      expect(_payByQr, findsNothing);
      expect(find.text('Я на месте'), findsOneWidget);
      await _reveal(tester, _code);
      await _reveal(tester, find.byKey(const ValueKey('payment-line')));
      expect(_inPaymentLine('Оплата на месте'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('an order paid at the store stays so once the kitchen took it', (tester) async {
      final api = FakeApi(flags: _web)..currentOrder = FakeApi.sampleOrder(status: 'ACCEPTED', payAtCounter: true);
      final h = await pumpApp(tester, api: api);
      await _openOrder(tester, h);

      expect(find.text('Принят кухней'), findsOneWidget);
      expect(_step('Оплата на месте'), findsOneWidget);
      expect(_payByCard, findsNothing);
      await _reveal(tester, find.byKey(const ValueKey('payment-line')));
      expect(_inPaymentLine('Оплата на месте'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('an unpaid order at a store that takes QR only is offered QR only', (tester) async {
      final api = _store(_webAndQr, online: {'card': false, 'qr': true})
        ..currentOrder = FakeApi.sampleOrder(currency: 'RUP');
      final h = await pumpApp(tester, api: api);
      await _openOrder(tester, h);

      expect(_payByQr, findsOneWidget);
      expect(_payByCard, findsNothing);
      await h.unmount(tester);
    });

    testWidgets('a store that says nothing online, with an order still unpaid, leaves the flags to decide', (
      tester,
    ) async {
      final api = _store(_webAndQr, online: {'card': false, 'qr': false})
        ..currentOrder = FakeApi.sampleOrder(currency: 'RUP');
      final h = await pumpApp(tester, api: api);
      await _openOrder(tester, h);

      // The order says it waits for an online payment: no dead end.
      expect(_payByCard, findsOneWidget);
      expect(_payByQr, findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('QR refused as unavailable from the order screen says so and leads back to the order', (tester) async {
      final api = _store(_qrOnly)
        ..qrStartFailure = (409, {'code': 'QR_PAYMENT_DISABLED', 'message': 'No QR terminal'})
        ..currentOrder = FakeApi.sampleOrder(currency: 'RUP');
      final h = await pumpApp(tester, api: api);
      await _openOrder(tester, h);
      await tester.tap(_payByQr);
      await settle(tester);

      expect(find.text(_unavailable), findsOneWidget);
      expect(find.text('Повторить'), findsNothing, reason: 'asking again cannot help');
      await tester.tap(find.byKey(const ValueKey('qr-primary')));
      await settle(tester);
      expect(find.text('Заказ #4821'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('a card payment refused as unavailable on the order screen is worded', (tester) async {
      final api = FakeApi(flags: _web)
        ..webPaymentFailure = (409, {'code': 'ONLINE_PAYMENT_UNAVAILABLE', 'message': 'No terminal'})
        ..currentOrder = FakeApi.sampleOrder();
      final h = await pumpApp(tester, api: api);
      await _openOrder(tester, h);
      await tester.tap(_payByCard);
      await settle(tester);

      expect(api.webPayments, hasLength(1));
      expect(find.text(_unavailable), findsOneWidget);
      await h.unmount(tester);
    });
  });
}
