import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/core/providers.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

/// Cards on the bank's page and QR in the bank's app, both on.
const _webAndQr = FeatureFlags(
  agroprombankEnabled: true,
  cardPaymentFlow: CardPaymentFlow.web,
  qrPaymentCurrencies: ['RUP'],
);

/// Cards off: QR is the only way to pay.
const _qrOnly = FeatureFlags(cardPaymentFlow: CardPaymentFlow.none, qrPaymentCurrencies: ['RUP']);

const _held = {'state': 'HELD', 'amountCents': 2000, 'cardMask': null, 'paidAt': null};
const _heldByQr = {..._held, 'provider': 'AGROPROMBANK_QR'};
const _refundedByQr = {
  'state': 'REFUNDED',
  'amountCents': 2000,
  'cardMask': null,
  'paidAt': null,
  'provider': 'AGROPROMBANK_QR',
};

/// A store selling in Transnistrian roubles, the currency QR takes.
FakeApi _rupStore(FeatureFlags flags) => FakeApi(flags: flags)
  ..storeExtra = {'currency': 'RUP'}
  ..orderCurrency = 'RUP';

/// 20 RUP as the app writes it: a no-break space before the currency.
const _total = '20\u00a0руб.';

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

/// The customer switches to the bank's app…
Future<void> _toBackground(WidgetTester tester) async {
  tester.binding
    ..handleAppLifecycleStateChanged(AppLifecycleState.inactive)
    ..handleAppLifecycleStateChanged(AppLifecycleState.hidden)
    ..handleAppLifecycleStateChanged(AppLifecycleState.paused);
  await tester.pump();
}

/// …and comes back.
Future<void> _toForeground(WidgetTester tester) async {
  tester.binding
    ..handleAppLifecycleStateChanged(AppLifecycleState.hidden)
    ..handleAppLifecycleStateChanged(AppLifecycleState.inactive)
    ..handleAppLifecycleStateChanged(AppLifecycleState.resumed);
  await tester.pump();
}

void main() {
  group('checkout', () {
    testWidgets('with cards and QR on, the customer picks QR, pays in the bank app and lands on the order', (
      tester,
    ) async {
      final api = _rupStore(_webAndQr)..seedCart(FakeApi.croissant());
      final h = await pumpApp(tester, api: api);
      await _openCheckout(tester);

      await _reveal(tester, find.byKey(const ValueKey('pay-method-qr')));
      expect(find.text('Картой'), findsOneWidget);
      expect(find.text('По QR в приложении банка'), findsOneWidget);
      expect(find.textContaining('на защищённой странице банка'), findsOneWidget, reason: 'a card is the default');

      await tester.tap(find.byKey(const ValueKey('pay-method-qr')));
      await settle(tester);
      expect(find.textContaining('Покажем QR-код'), findsOneWidget);
      expect(find.textContaining('на защищённой странице банка'), findsNothing);
      expect(h.container.read(sharedPreferencesProvider).getString('checkout.payMethod'), 'qr', reason: 'remembered');

      await tester.tap(find.textContaining('Оплатить'));
      await settle(tester, const Duration(seconds: 2));

      expect(api.created, hasLength(1));
      expect(api.qrStarts, ['ord_1']);
      expect(h.webPayments.opened, isEmpty, reason: 'no bank page in the QR flow');
      expect(find.text('Оплата по QR'), findsOneWidget);
      expect(find.byType(QrImageView), findsOneWidget);
      expect(find.text(_total), findsOneWidget);
      expect(find.textContaining('Код действует ещё 9:5'), findsOneWidget);
      expect(find.text('Отсканируйте код в приложении Агропромбанка (раздел «Оплата по QR»)'), findsOneWidget);
      expect(find.text('Код можно отсканировать и с другого устройства.'), findsNothing);
      expect(api.qrPolls, isEmpty, reason: 'checkout handed the invoice over; nothing asked twice');

      await tester.tap(find.byKey(const ValueKey('qr-open-bank')));
      await settle(tester);
      expect(h.bankApp.opened.single, Uri.parse(api.qrAppLink!));

      // Polled every 3 s while the code is up; not while the bank app is.
      await tester.pump(const Duration(seconds: 3));
      final polls = api.qrPolls.length;
      expect(polls, greaterThan(0));
      await _toBackground(tester);
      await tester.pump(const Duration(seconds: 15));
      expect(api.qrPolls, hasLength(polls));
      expect(api.qrCancels, isEmpty, reason: 'leaving for the bank app never calls the invoice off');

      // Paid in the bank app; back in ours the invoice is checked at once.
      api
        ..qrStatus = 'PAID'
        ..currentOrder = FakeApi.sampleOrder(currency: 'RUP', payment: _held);
      await _toForeground(tester);
      await settle(tester);

      expect(api.qrPolls, hasLength(polls + 1));
      expect(find.text('Заказ #4821'), findsOneWidget);
      expect(find.text('Оплачено по QR'), findsOneWidget, reason: 'this phone saw it paid by QR');
      expect(find.text('Если заведение не примет заказ, деньги вернутся.'), findsOneWidget);
      expect(find.text('Спишем при принятии заказа'), findsNothing);
      await h.unmount(tester);
    });

    testWidgets('the last choice is offered first next time', (tester) async {
      final api = _rupStore(_webAndQr)..seedCart(FakeApi.croissant());
      final h = await pumpApp(tester, api: api, saved: {'checkout.payMethod': 'qr'});
      await _openCheckout(tester);
      await _reveal(tester, find.textContaining('Покажем QR-код'));
      expect(find.textContaining('на защищённой странице банка'), findsNothing);
      await h.unmount(tester);
    });

    testWidgets('with cards off QR is the only way to pay, and a scan-only code says so', (tester) async {
      final api = _rupStore(_qrOnly)
        ..qrAppLink = null
        ..seedCart(FakeApi.croissant());
      final h = await pumpApp(tester, api: api);
      await _openCheckout(tester);

      await _reveal(tester, find.textContaining('Покажем QR-код'));
      expect(find.byKey(const ValueKey('pay-method-card')), findsNothing, reason: 'nothing to choose from');
      expect(find.textContaining('Оплата картой сейчас недоступна'), findsNothing);

      await tester.tap(find.textContaining('Оплатить'));
      await settle(tester, const Duration(seconds: 2));
      expect(api.qrStarts, ['ord_1']);
      expect(find.byKey(const ValueKey('qr-open-bank')), findsNothing);
      expect(find.text('Код можно отсканировать и с другого устройства.'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('a bank that is down keeps the customer on checkout and the retry issues no second order', (
      tester,
    ) async {
      final api = _rupStore(_qrOnly)
        ..qrStartFailure = (503, {'code': 'QR_BANK_UNAVAILABLE', 'message': 'Bank unavailable'})
        ..seedCart(FakeApi.croissant());
      final h = await pumpApp(tester, api: api);
      await _openCheckout(tester);

      await tester.tap(find.textContaining('Оплатить'));
      await settle(tester, const Duration(seconds: 2));
      expect(find.text('Банк не отвечает. Попробуйте ещё раз через минуту.'), findsOneWidget);
      expect(find.text('Оплатить снова'), findsOneWidget);

      await tester.tap(find.text('Оплатить снова'));
      await settle(tester, const Duration(seconds: 2));
      expect(api.created, hasLength(1));
      expect(api.qrStarts, ['ord_1', 'ord_1']);
      expect(find.byType(QrImageView), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('a store in another currency is not offered QR', (tester) async {
      final api = FakeApi(flags: _webAndQr)..seedCart(FakeApi.croissant());
      final h = await pumpApp(tester, api: api);
      await _openCheckout(tester);
      await _reveal(tester, find.textContaining('на защищённой странице банка'));
      expect(find.byKey(const ValueKey('pay-method-qr')), findsNothing);
      await h.unmount(tester);
    });
  });

  group('QR screen from the order', () {
    testWidgets('an unpaid order is paid by QR from its screen; «Отменить» closes the invoice, not the order', (
      tester,
    ) async {
      final api = _rupStore(_qrOnly)..currentOrder = FakeApi.sampleOrder(currency: 'RUP');
      final h = await pumpApp(tester, api: api);
      await _openOrder(tester, h);

      expect(find.byKey(const ValueKey('pay')), findsNothing, reason: 'cards are off');
      await tester.tap(find.text('Оплатить $_total по QR'));
      await settle(tester);
      expect(api.qrStarts, ['ord_1']);
      expect(find.byType(QrImageView), findsOneWidget);

      // The cross leaves the invoice as it is; paying again shows it again.
      await tester.tap(find.byIcon(Icons.close_rounded).first);
      await settle(tester);
      expect(find.text('Заказ #4821'), findsOneWidget);
      expect(api.qrCancels, isEmpty);
      await tester.tap(find.text('Оплатить $_total по QR'));
      await settle(tester);
      expect(api.qrStarts, ['ord_1', 'ord_1']);
      expect(find.textContaining('Код действует ещё'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('qr-cancel')));
      await settle(tester);
      expect(api.qrCancels, ['pay_qr_1']);
      expect(api.cancelled, isEmpty, reason: 'the order stays, to be paid again');
      expect(find.text('Заказ #4821'), findsOneWidget);
      expect(find.text('Оплатить $_total по QR'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('an expired invoice offers a new code or paying by card', (tester) async {
      final api = _rupStore(_webAndQr)
        ..qrLifetime = const Duration(seconds: 30)
        ..currentOrder = FakeApi.sampleOrder(currency: 'RUP');
      final h = await pumpApp(tester, api: api);
      await _openOrder(tester, h);

      expect(find.text('Оплатить $_total'), findsOneWidget, reason: 'the card flow comes first by default');
      await tester.tap(find.byKey(const ValueKey('pay-qr')));
      await settle(tester);
      expect(find.textContaining('Код действует ещё 0:'), findsOneWidget);

      await tester.pump(const Duration(seconds: 31));
      await settle(tester);
      expect(find.text('Счёт истёк'), findsOneWidget);
      expect(find.byType(QrImageView), findsNothing);
      expect(find.text('Новый QR-код'), findsOneWidget);
      expect(find.text('Оплатить картой'), findsOneWidget);

      await tester.tap(find.text('Новый QR-код'));
      await settle(tester);
      expect(api.qrStarts, hasLength(2));
      expect(find.byType(QrImageView), findsOneWidget);

      await tester.pump(const Duration(seconds: 31));
      await settle(tester);
      await tester.tap(find.text('Оплатить картой'));
      await settle(tester);
      expect(api.webPayments.single.orderId, 'ord_1');
      expect(h.webPayments.opened, hasLength(1));
      expect(find.text('Заказ #4821'), findsOneWidget, reason: 'the order screen waits under the bank page');
      await h.unmount(tester);
    });

    testWidgets('with bound cards an expired invoice is paid with the default card instead', (tester) async {
      final api = _rupStore(const FeatureFlags(agroprombankEnabled: true, qrPaymentCurrencies: ['RUP']))
        ..boundCards = [FakeApi.card()]
        ..qrLifetime = const Duration(seconds: 30)
        ..currentOrder = FakeApi.sampleOrder(currency: 'RUP');
      final h = await pumpApp(tester, api: api);
      await _openOrder(tester, h);

      // No card retry on the order screen in the bound-card flow: QR is it.
      expect(find.byKey(const ValueKey('pay')), findsNothing);
      await tester.tap(find.text('Оплатить $_total по QR'));
      await settle(tester);
      await tester.pump(const Duration(seconds: 31));
      await settle(tester);

      api.currentOrder = FakeApi.sampleOrder(currency: 'RUP', payment: {..._held, 'cardMask': '•••• 1234'});
      await tester.tap(find.text('Оплатить картой · •••• 1234'));
      await settle(tester);
      expect(api.paid.single, {'orderId': 'ord_1', 'cardId': 'card_1'});
      expect(find.text('Спишем при принятии заказа'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('the customer who paid by QR last time gets QR first on the order screen', (tester) async {
      final api = _rupStore(_webAndQr)..currentOrder = FakeApi.sampleOrder(currency: 'RUP');
      final h = await pumpApp(tester, api: api, saved: {'checkout.payMethod': 'qr'});
      await _openOrder(tester, h);
      expect(find.text('Оплатить $_total по QR'), findsOneWidget);
      expect(find.text('Оплатить картой'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('a bank that cannot issue the invoice says so and the retry gets the code', (tester) async {
      final api = _rupStore(_qrOnly)
        ..qrStartFailure = (503, {'code': 'QR_BANK_UNAVAILABLE', 'message': 'Bank unavailable'})
        ..currentOrder = FakeApi.sampleOrder(currency: 'RUP');
      final h = await pumpApp(tester, api: api);
      await _openOrder(tester, h);
      await tester.tap(find.byKey(const ValueKey('pay-qr')));
      await settle(tester);

      expect(find.text('Не удалось получить QR-код'), findsOneWidget);
      expect(find.text('Банк не отвечает. Попробуйте ещё раз через минуту.'), findsOneWidget);
      expect(find.text('Оплатить картой'), findsNothing, reason: 'cards are off');

      await tester.tap(find.text('Повторить'));
      await settle(tester);
      expect(find.byType(QrImageView), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('an order that can no longer be paid leads back to it', (tester) async {
      final api = _rupStore(_qrOnly)
        ..qrStartFailure = (409, {'code': 'ORDER_NOT_PAYABLE', 'message': 'Order is cancelled'})
        ..currentOrder = FakeApi.sampleOrder(currency: 'RUP');
      final h = await pumpApp(tester, api: api);
      await _openOrder(tester, h);
      await tester.tap(find.byKey(const ValueKey('pay-qr')));
      await settle(tester);

      expect(find.text('Этот заказ уже нельзя оплатить'), findsOneWidget);
      expect(find.text('Повторить'), findsNothing);
      await tester.tap(find.byKey(const ValueKey('qr-primary')));
      await settle(tester);
      expect(find.text('Заказ #4821'), findsOneWidget);
      await h.unmount(tester);
    });
  });

  group('order screen wording', () {
    testWidgets('paid by QR before the store accepts: the money is returned if it does not', (tester) async {
      final api = _rupStore(_qrOnly)..currentOrder = FakeApi.sampleOrder(currency: 'RUP', payment: _heldByQr);
      final h = await pumpApp(tester, api: api);
      await _openOrder(tester, h);

      expect(find.text('Оплачено по QR'), findsOneWidget);
      expect(find.text('Если заведение не примет заказ, деньги вернутся.'), findsOneWidget);
      expect(find.byKey(const ValueKey('pay-qr')), findsNothing, reason: 'nothing left to pay');

      await _reveal(tester, find.text('Отменить заказ'));
      await tester.tap(find.text('Отменить заказ'));
      await settle(tester);
      expect(find.text('Точка ещё не приняла заказ. Деньги, оплаченные по QR, вернутся.'), findsOneWidget);
      await tester.tap(find.text('Оставить'));
      await settle(tester);
      await h.unmount(tester);
    });

    testWidgets('a cancelled QR order says the money was returned', (tester) async {
      final api = _rupStore(_qrOnly)
        ..currentOrder = FakeApi.sampleOrder(
          currency: 'RUP',
          status: 'CANCELLED',
          cancelledBy: 'STORE',
          cancelReason: 'TOO_BUSY',
          cancelMoney: 'REFUNDED',
          payment: _refundedByQr,
        );
      final h = await pumpApp(tester, api: api);
      await _openOrder(tester, h);

      await _reveal(tester, find.byKey(const ValueKey('cancel-reason')));
      expect(find.text('Деньги, оплаченные по QR, вернули.'), findsOneWidget);
      expect(find.text('Деньги вернутся на карту.'), findsNothing);
      await _reveal(tester, find.byKey(const ValueKey('payment-line')));
      expect(find.text('Деньги возвращены'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('a hold the order cannot tell apart keeps the card wording', (tester) async {
      final api = _rupStore(_webAndQr)..currentOrder = FakeApi.sampleOrder(currency: 'RUP', payment: _held);
      final h = await pumpApp(tester, api: api);
      await _openOrder(tester, h);
      expect(find.text('Спишем при принятии заказа'), findsOneWidget);
      expect(find.text('Оплачено по QR'), findsNothing);
      await h.unmount(tester);
    });
  });
}
