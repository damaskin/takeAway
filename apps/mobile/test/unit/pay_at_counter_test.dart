import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/features/orders/order_progress.dart';
import 'package:takeaway_mobile/features/orders/order_wait.dart';

import '../helpers/fake_api.dart';

/// Orders paid at the store (`payAtCounter`, owner decision 2026-11-27) and
/// orders still waiting for their online payment.
void main() {
  const held = {'state': 'HELD', 'amountCents': 2000, 'cardMask': null, 'paidAt': null};
  const pending = {'state': 'PENDING', 'amountCents': 2000, 'cardMask': null, 'paidAt': null};

  test('a new unpaid order waits for its online payment; one paid at the store never does', () {
    expect(awaitsOnlinePayment(FakeApi.sampleOrder()), isTrue);
    expect(awaitsOnlinePayment(FakeApi.sampleOrder(payment: pending)), isTrue);
    expect(awaitsOnlinePayment(FakeApi.sampleOrder(payAtCounter: true)), isFalse);
    expect(awaitsOnlinePayment(FakeApi.sampleOrder(payment: held)), isFalse);
    expect(awaitsOnlinePayment(FakeApi.sampleOrder(discountCents: 2000)), isFalse, reason: 'nothing to pay');
    expect(awaitsOnlinePayment(FakeApi.sampleOrder(status: 'ACCEPTED')), isFalse);
  });

  test('an order paid at the store is on the kitchen board from the start', () {
    expect(isAwaitingAcceptance(FakeApi.sampleOrder(payAtCounter: true)), isTrue);
    expect(isAwaitingAcceptance(FakeApi.sampleOrder()), isFalse, reason: 'unpaid: the kitchen does not see it');
    expect(isAwaitingAcceptance(FakeApi.sampleOrder(payment: held)), isTrue);
  });

  test('the first step: waiting for the payment, paid at the store, or received', () {
    expect(orderFirstStep(FakeApi.sampleOrder()), OrderFirstStep.awaitingPayment);
    expect(orderFirstStep(FakeApi.sampleOrder(payAtCounter: true)), OrderFirstStep.payAtCounter);
    expect(orderFirstStep(FakeApi.sampleOrder(status: 'READY', payAtCounter: true)), OrderFirstStep.payAtCounter);
    expect(orderFirstStep(FakeApi.sampleOrder(payment: held)), OrderFirstStep.received);
    expect(orderFirstStep(FakeApi.sampleOrder(status: 'PAID')), OrderFirstStep.received);
    expect(orderFirstStep(FakeApi.sampleOrder(status: 'IN_PROGRESS')), OrderFirstStep.received);
  });

  test('a cancelled order paid at the store has no card money to speak of', () {
    final atCounter = FakeApi.sampleOrder(status: 'CANCELLED', cancelledBy: 'STORE', payAtCounter: true);
    expect(endedOrderMoney(atCounter), isNull);
    expect(orderCancellation(atCounter)!.money, isNull);
    expect(endedOrderMoney(FakeApi.sampleOrder(status: 'CANCELLED', cancelledBy: 'STORE')), CancelledMoney.notCharged);
    expect(
      endedOrderMoney(FakeApi.sampleOrder(status: 'CANCELLED', payAtCounter: true, cancelMoney: 'NOT_CHARGED')),
      CancelledMoney.notCharged,
      reason: 'what the API recorded still wins',
    );
  });
}
