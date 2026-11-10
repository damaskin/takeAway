import 'dart:async';

import 'package:dio/dio.dart';
import 'package:fake_async/fake_async.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/core/network/api_error.dart';
import 'package:takeaway_mobile/core/providers.dart';
import 'package:takeaway_mobile/features/catalog/catalog_providers.dart';
import 'package:takeaway_mobile/features/checkout/qr_payment.dart';

import '../helpers/fake_api.dart';

/// An API that cannot be reached for its features.
class _OfflineApi extends FakeApi {
  @override
  Future<FeatureFlags> features() async => throw DioException(
    requestOptions: RequestOptions(path: '/config/features'),
    type: DioExceptionType.connectionError,
  );
}

void main() {
  late SharedPreferences prefs;

  setUp(() async {
    SharedPreferences.setMockInitialValues({});
    prefs = await SharedPreferences.getInstance();
  });

  /// Runs [body] on fake time with the QR controller of `ord_1` kept alive.
  void run(void Function(FakeAsync async, FakeApi api, ProviderContainer container) body, {FakeApi? api}) {
    fakeAsync((async) {
      final start = DateTime.utc(2026, 11, 10, 12);
      DateTime now() => start.add(async.elapsed);
      final fake = (api ?? FakeApi())..now = now;
      final container = ProviderContainer(
        overrides: [
          sharedPreferencesProvider.overrideWithValue(prefs),
          apiProvider.overrideWithValue(fake),
          qrClockProvider.overrideWithValue(now),
        ],
      );
      final sub = container.listen(qrPaymentProvider('ord_1'), (_, _) {});
      body(async, fake, container);
      sub.close();
      container.dispose();
      async.flushTimers(flushPeriodicTimers: false);
    });
  }

  QrPaymentController controller(ProviderContainer c) => c.read(qrPaymentProvider('ord_1').notifier);
  QrPaymentState current(ProviderContainer c) => c.read(qrPaymentProvider('ord_1'));

  test('issues the invoice and polls it every 3 s until it is paid', () {
    run((async, api, c) {
      unawaited(controller(c).open());
      async.flushMicrotasks();
      expect(api.qrStarts, ['ord_1']);
      expect(current(c).phase, QrPhase.pending);
      expect(current(c).code!.code, 'QRT000000000000001:20:1000042');

      async.elapse(const Duration(seconds: 2));
      expect(api.qrPolls, isEmpty);
      async.elapse(const Duration(seconds: 1));
      expect(api.qrPolls, ['pay_qr_1']);
      async.elapse(const Duration(seconds: 6));
      expect(api.qrPolls, hasLength(3));

      api.qrStatus = 'PAID';
      async.elapse(const Duration(seconds: 3));
      expect(current(c).phase, QrPhase.paid);
      expect(QrPaidOrders(prefs).contains('ord_1'), isTrue, reason: 'the order screen words it as paid by QR');

      async.elapse(const Duration(seconds: 30));
      expect(api.qrPolls, hasLength(4), reason: 'nothing to poll once it is paid');
    });
  });

  test('shows the invoice checkout started without asking for it again', () {
    run((async, api, c) {
      final initial = QrPayment.fromJson(FakeApi.qrInvoiceJson(expiresAt: DateTime.utc(2026, 11, 10, 12, 10)));
      unawaited(controller(c).open(initial: initial));
      async.flushMicrotasks();
      expect(api.qrStarts, isEmpty);
      expect(current(c).phase, QrPhase.pending);
      expect(current(c).code!.appLinkUri, isNull);
      async.elapse(const Duration(seconds: 3));
      expect(api.qrPolls, ['pay_qr_1']);
    });
  });

  test('does not poll in the background and checks at once on coming back', () {
    run((async, api, c) {
      unawaited(controller(c).open());
      async.flushMicrotasks();

      controller(c).pause();
      async.elapse(const Duration(seconds: 30));
      expect(api.qrPolls, isEmpty, reason: 'the customer is in the bank app');
      expect(api.qrCancels, isEmpty, reason: 'going away never calls the invoice off');

      api.qrStatus = 'PAID';
      controller(c).resume();
      async.flushMicrotasks();
      expect(api.qrPolls, hasLength(1), reason: 'checked the moment the app is back');
      expect(current(c).phase, QrPhase.paid);
    });
  });

  test('a code past its time reads as expired, is checked a while longer, then left alone', () {
    run((async, api, c) {
      unawaited(controller(c).open());
      async.flushMicrotasks();

      async.elapse(const Duration(minutes: 10));
      expect(current(c).phase, QrPhase.expired);
      final polls = api.qrPolls.length;
      async.elapse(const Duration(seconds: 30));
      expect(api.qrPolls.length, greaterThan(polls), reason: 'a payment in the last second may still land');

      async.elapse(const Duration(minutes: 2));
      final settled = api.qrPolls.length;
      async.elapse(const Duration(minutes: 1));
      expect(api.qrPolls, hasLength(settled), reason: 'past the grace nothing is asked any more');
      expect(current(c).phase, QrPhase.expired);

      // «Новый QR-код»: a fresh invoice.
      unawaited(controller(c).start());
      async.flushMicrotasks();
      expect(api.qrStarts, hasLength(2));
      expect(current(c).phase, QrPhase.pending);
      expect(current(c).payment!.paymentId, 'pay_qr_2');
    });
  });

  test('the server saying EXPIRED stops polling at once', () {
    run((async, api, c) {
      unawaited(controller(c).open());
      async.flushMicrotasks();
      api.qrStatus = 'EXPIRED';
      async.elapse(const Duration(seconds: 3));
      expect(current(c).phase, QrPhase.expired);
      async.elapse(const Duration(seconds: 30));
      expect(api.qrPolls, hasLength(1));
    });
  });

  test('a bank that is down fails the start with its code and can be retried', () {
    run((async, api, c) {
      api.qrStartFailure = (503, {'code': 'QR_BANK_UNAVAILABLE', 'message': 'Bank unavailable'});
      unawaited(controller(c).open());
      async.flushMicrotasks();
      expect(current(c).phase, QrPhase.failed);
      expect(current(c).error!.code, 'QR_BANK_UNAVAILABLE');
      expect(current(c).error!.kind, ApiErrorKind.server);

      unawaited(controller(c).start());
      async.flushMicrotasks();
      expect(current(c).phase, QrPhase.pending);
    });
  });

  test('an invoice the bank refused reads as failed, with no API error', () {
    run((async, api, c) {
      api.qrStatus = 'FAILED';
      unawaited(controller(c).open(initial: QrPayment.fromJson(FakeApi.qrInvoiceJson(status: 'FAILED'))));
      async.flushMicrotasks();
      expect(current(c).phase, QrPhase.failed);
      expect(current(c).error, isNull);
    });
  });

  test('a failed poll keeps the code up and the next tick asks again', () {
    run((async, api, c) {
      unawaited(controller(c).open());
      async.flushMicrotasks();
      api.qrPollFailure = 503;
      async.elapse(const Duration(seconds: 6));
      expect(api.qrPolls, hasLength(2));
      expect(current(c).phase, QrPhase.pending);

      api
        ..qrPollFailure = null
        ..qrStatus = 'PAID';
      async.elapse(const Duration(seconds: 3));
      expect(current(c).phase, QrPhase.paid);
    });
  });

  test('cancel closes the invoice; one paid meanwhile reads as paid', () {
    run((async, api, c) {
      unawaited(controller(c).open());
      async.flushMicrotasks();

      QrPhase? ended;
      unawaited(controller(c).cancel().then((phase) => ended = phase));
      async.flushMicrotasks();
      expect(api.qrCancels, ['pay_qr_1']);
      expect(ended, QrPhase.cancelled);
      expect(current(c).phase, QrPhase.cancelled);
      async.elapse(const Duration(seconds: 30));
      expect(api.qrPolls, isEmpty);
    });

    run((async, api, c) {
      unawaited(controller(c).open());
      async.flushMicrotasks();
      api.qrStatus = 'PAID';
      QrPhase? ended;
      unawaited(controller(c).cancel().then((phase) => ended = phase));
      async.flushMicrotasks();
      expect(ended, QrPhase.paid);
      expect(current(c).phase, QrPhase.paid);
    });
  });

  test('a cancel that does not get through keeps the code up and polling', () {
    run((async, api, c) {
      unawaited(controller(c).open());
      async.flushMicrotasks();
      api.qrCancelFailure = 503;
      Object? failure;
      unawaited(
        controller(c).cancel().catchError((Object error) {
          failure = error;
          return QrPhase.pending;
        }),
      );
      async.flushMicrotasks();
      expect(failure, isA<ApiError>());
      expect(current(c).phase, QrPhase.pending);
      expect(current(c).cancelling, isFalse);
      async.elapse(const Duration(seconds: 3));
      expect(api.qrPolls, hasLength(1));
    });
  });

  group('around the invoice', () {
    test('the QR currencies are kept for when the API cannot be reached', () async {
      final online = ProviderContainer(
        overrides: [
          sharedPreferencesProvider.overrideWithValue(prefs),
          apiProvider.overrideWithValue(FakeApi(flags: const FeatureFlags(qrPaymentCurrencies: ['RUP']))),
        ],
      );
      addTearDown(online.dispose);
      expect((await online.read(featureFlagsProvider.future)).qrPaymentsFor('RUP'), isTrue);
      await Future<void>.delayed(Duration.zero);

      final offline = ProviderContainer(
        overrides: [sharedPreferencesProvider.overrideWithValue(prefs), apiProvider.overrideWithValue(_OfflineApi())],
      );
      addTearDown(offline.dispose);
      expect((await offline.read(featureFlagsProvider.future)).qrPaymentCurrencies, ['RUP']);
      expect(FeatureFlagsCache.keys, contains(FeatureFlagsCache.qrCurrencies), reason: 'forgotten on a stand switch');
    });

    test('the order names its provider; without it, what this phone saw paid by QR', () async {
      final seen = QrPaidOrders(prefs);
      final heldJson = {'state': 'HELD', 'amountCents': 2000, 'cardMask': null, 'paidAt': null};
      final held = FakeApi.sampleOrder(payment: heldJson);
      expect(orderPaidByQr(held, seen), isFalse);

      await seen.add('ord_1');
      expect(orderPaidByQr(held, seen), isTrue);
      final byCard = FakeApi.sampleOrder(payment: {...heldJson, 'provider': 'AGROPROMBANK_WEB'});
      expect(orderPaidByQr(byCard, seen), isFalse, reason: "the API's word wins");

      for (var i = 0; i < QrPaidOrders.keep + 5; i++) {
        await seen.add('ord_x$i');
      }
      expect(prefs.getStringList(QrPaidOrders.prefsKey), hasLength(QrPaidOrders.keep));
      expect(seen.contains('ord_1'), isFalse, reason: 'only the newest are kept');
    });
  });
}
