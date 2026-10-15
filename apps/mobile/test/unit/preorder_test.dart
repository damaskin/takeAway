import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/features/orders/order_wait.dart';
import 'package:takeaway_mobile/shared/store_hours.dart';

import '../helpers/fake_api.dart';

Store store(Map<String, dynamic> fields) => Store.fromJson({...FakeApi.storeJson, ...fields});

void main() {
  group('store hours', () {
    final evening = DateTime(2026, 10, 14, 22, 30);
    final night = DateTime(2026, 10, 15, 1);
    final nineTomorrow = DateTime(2026, 10, 15, 9);

    test('counts calendar days on the device clock', () {
      expect(calendarDaysBetween(evening, nineTomorrow), 1);
      expect(calendarDaysBetween(night, nineTomorrow), 0);
      expect(calendarDaysBetween(evening, DateTime(2026, 10, 16, 9)), 2);
    });

    test('names the opening time while the store takes pre-orders only', () {
      final closed = store({
        'openNow': false,
        'acceptingOrders': true,
        'asapBlockedReason': 'OUTSIDE_HOURS',
        'opensAt': nineTomorrow.toUtc().toIso8601String(),
      });
      final note = storeHoursNote(closed, now: evening)!;
      expect(note.kind, StoreHoursKind.opens);
      expect(note.days, 1);
      expect(note.at, nineTomorrow.toUtc());
      expect(storeHoursNote(closed, now: night)!.days, 0);
    });

    test('offers pre-orders with a full queue or before the shift, and says until when while open', () {
      expect(
        storeHoursNote(store({'openNow': false, 'acceptingOrders': true, 'asapBlockedReason': 'QUEUE_FULL'}))!.kind,
        StoreHoursKind.queueFull,
      );
      expect(
        storeHoursNote(store({'openNow': false, 'acceptingOrders': true, 'asapBlockedReason': 'SHIFT_CLOSED'}))!.kind,
        StoreHoursKind.preorder,
      );
      final open = store({'openNow': true, 'acceptingOrders': true, 'closesAt': '2026-10-15T18:00:00Z'});
      expect(storeHoursNote(open)!.kind, StoreHoursKind.until);
      expect(storeHoursNote(store({'openNow': true, 'acceptingOrders': true})), isNull);
    });

    test('adds nothing for a store taking no orders, or one from an older API', () {
      expect(storeHoursNote(store({'openNow': false, 'acceptingOrders': false})), isNull);
      expect(storeHoursNote(store({'openNow': false})), isNull, reason: 'no acceptingOrders: closed, as before');
      expect(storeHoursNote(store({'openNow': true})), isNull);
    });
  });

  group('order wait', () {
    final now = DateTime.now();
    const held = {'state': 'HELD', 'amountCents': 2000, 'cardMask': null, 'paidAt': null};
    final closed = store({'openNow': false, 'acceptingOrders': true, 'asapBlockedReason': 'OUTSIDE_HOURS'});
    final open = store({'openNow': true, 'acceptingOrders': true});

    test('a pre-order on the board while the store is closed waits for it to open', () {
      final order = FakeApi.sampleOrder(payment: held, pickupMode: 'SCHEDULED');
      expect(orderWaitNote(order, closed, now), OrderWaitNote.preorderAwaitingOpening);
      expect(orderWaitNote(order, open, now), OrderWaitNote.awaitingAcceptance);
      expect(orderWaitNote(order, null, now), OrderWaitNote.awaitingAcceptance);
      expect(
        orderWaitNote(
          order,
          store({'openNow': false, 'acceptingOrders': true, 'asapBlockedReason': 'QUEUE_FULL'}),
          now,
        ),
        OrderWaitNote.awaitingAcceptance,
      );
    });

    test('an order not yet paid is not waiting for the store', () {
      expect(orderWaitNote(FakeApi.sampleOrder(), open, now), isNull);
    });

    test('an accepted order past its time is late', () {
      final past = now.subtract(const Duration(minutes: 3));
      expect(orderWaitNote(FakeApi.sampleOrder(status: 'IN_PROGRESS', pickupAt: past), open, now), OrderWaitNote.late);
      expect(orderWaitNote(FakeApi.sampleOrder(status: 'ACCEPTED'), open, now), isNull);
      expect(orderWaitNote(FakeApi.sampleOrder(status: 'READY', pickupAt: past), open, now), isNull);
    });

    test('an expired order says whether the store never accepted it or the payment never went through', () {
      Order expired(String state) => FakeApi.sampleOrder(
        status: 'EXPIRED',
        payment: {'state': state, 'amountCents': 2000, 'cardMask': null, 'paidAt': null},
      );
      expect(expiredOutcome(expired('NONE')), ExpiredOutcome.notAccepted);
      expect(expiredOutcome(expired('HELD')), ExpiredOutcome.notAccepted);
      expect(expiredOutcome(expired('REFUNDED')), ExpiredOutcome.notAcceptedRefunded);
      expect(expiredOutcome(expired('FAILED')), ExpiredOutcome.paymentNotCompleted);
      expect(expiredOutcome(expired('PENDING')), ExpiredOutcome.paymentNotCompleted);
    });
  });
}
