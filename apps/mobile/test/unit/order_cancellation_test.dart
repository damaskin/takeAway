import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/features/orders/order_wait.dart';

import '../helpers/fake_api.dart';

/// The same rules as `orderCancellation` in `@takeaway/utils`.
void main() {
  Order cancelled({String? by, String? reason, String? comment, String state = 'NONE', String? money}) =>
      FakeApi.sampleOrder(
        status: 'CANCELLED',
        cancelledBy: by,
        cancelReason: reason,
        cancelComment: comment,
        cancelMoney: money,
        payment: {'state': state, 'amountCents': 2000, 'cardMask': null, 'paidAt': null},
      );

  test('says nothing about an order that is not cancelled', () {
    expect(orderCancellation(FakeApi.sampleOrder(status: 'EXPIRED')), isNull);
    expect(orderCancellation(FakeApi.sampleOrder(status: 'READY', cancelledBy: 'STORE')), isNull);
  });

  test("gives the kitchen's reason and its comment, trimmed", () {
    final c = orderCancellation(cancelled(by: 'STORE', reason: 'OUT_OF_STOCK', comment: '  Нет молока '))!;
    expect(c.by, CancelledParty.store);
    expect(c.reason, OrderCancelReason.outOfStock);
    expect(c.comment, 'Нет молока');
    expect(c.money, CancelledMoney.notCharged);
    expect(orderCancellation(cancelled(by: 'STORE', reason: 'TOO_BUSY', comment: '  '))!.comment, isNull);
  });

  test('tells a declined card from the kitchen turning the order down', () {
    final c = orderCancellation(cancelled(by: 'STORE', reason: 'CARD_DECLINED', comment: 'x'))!;
    expect(c.by, CancelledParty.cardDeclined);
    expect(c.reason, isNull);
    expect(c.comment, isNull);
  });

  test("keeps the customer's own cancel free of a reason, and leaves an old order's open", () {
    final own = orderCancellation(cancelled(by: 'CUSTOMER', reason: 'OTHER', comment: 'x'))!;
    expect(own.by, CancelledParty.customer);
    expect(own.reason, isNull);
    expect(own.comment, isNull);
    expect(orderCancellation(cancelled())!.by, isNull);
  });

  test('says where the money is, as the push did', () {
    CancelledMoney? money(String state, {String by = 'STORE'}) =>
        orderCancellation(cancelled(by: by, state: state))!.money;
    expect(money('NONE'), CancelledMoney.notCharged);
    expect(money('FAILED'), CancelledMoney.notCharged);
    expect(money('HELD'), CancelledMoney.holdPending);
    expect(money('REFUNDED'), CancelledMoney.refunded);
    expect(money('PAID'), CancelledMoney.refunded);
    expect(money('REFUNDED', by: 'CUSTOMER'), CancelledMoney.released);
    expect(money('PENDING'), isNull);
  });

  // The store turned down an order paid with a card hold: the push said the
  // hold came off, and a released hold reads as a refunded payment.
  test('says what the push said once the API recorded where the money went', () {
    CancelledMoney? money(String recorded, String state) =>
        orderCancellation(cancelled(by: 'STORE', state: state, money: recorded))!.money;
    expect(money('RELEASED', 'REFUNDED'), CancelledMoney.released);
    expect(money('REFUNDED', 'REFUNDED'), CancelledMoney.refunded);
    expect(money('NOT_CHARGED', 'NONE'), CancelledMoney.notCharged);
    expect(money('PENDING', 'HELD'), CancelledMoney.holdPending);
  });

  test('speaks of the money of expired orders too, and of no live one', () {
    final expired = FakeApi.sampleOrder(
      status: 'EXPIRED',
      cancelMoney: 'RELEASED',
      payment: {'state': 'REFUNDED', 'amountCents': 2000, 'cardMask': null, 'paidAt': null},
    );
    expect(endedOrderMoney(expired), CancelledMoney.released);
    expect(expiredOutcome(expired), ExpiredOutcome.notAccepted);
    expect(
      expiredOutcome(
        FakeApi.sampleOrder(
          status: 'EXPIRED',
          cancelMoney: 'REFUNDED',
          payment: {'state': 'REFUNDED', 'amountCents': 2000, 'cardMask': null, 'paidAt': null},
        ),
      ),
      ExpiredOutcome.notAcceptedRefunded,
    );
    expect(
      endedOrderMoney(
        FakeApi.sampleOrder(
          status: 'ACCEPTED',
          cancelMoney: 'RELEASED',
          payment: {'state': 'HELD', 'amountCents': 2000, 'cardMask': null, 'paidAt': null},
        ),
      ),
      isNull,
    );
  });
}
