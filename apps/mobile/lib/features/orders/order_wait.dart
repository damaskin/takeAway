import 'package:takeaway_api/takeaway_api.dart';

/// What the order screen says while the customer waits, on top of the bare
/// status. The same rules as the web (`orderWaitNote` in `@takeaway/utils`).
enum OrderWaitNote {
  /// Accepted or being made, and its time ([Order.dueAt]) has passed — the
  /// customer may already be at the counter: «Немного задерживаемся».
  late,

  /// Accepted or being made too late for the promised time, so the kitchen
  /// gave a new estimate ([Order.readyEstimateAt]) and it has not passed
  /// yet: «Готовим · будет готово через 8 мин».
  newEstimate,

  /// A pre-order on the kitchen board while the store is closed (overnight,
  /// or before the shift): it is accepted once the store opens.
  preorderAwaitingOpening,

  /// On the kitchen board, not accepted yet.
  awaitingAcceptance,
}

/// On the kitchen board and not accepted yet: the card hold went through (or
/// there was nothing to pay), or — from before charge-on-accept — it was paid
/// outright. A new order whose card has not gone through is not on the board.
bool isAwaitingAcceptance(Order order) => switch (order.status) {
  OrderStatus.paid => true,
  OrderStatus.created => switch (order.payment.state) {
    PaymentState.held || PaymentState.paid => true,
    PaymentState.none => order.totalCents == 0,
    _ => false,
  },
  _ => false,
};

/// [store] is the store as it is now; without it a pre-order reads as simply
/// awaiting acceptance.
OrderWaitNote? orderWaitNote(Order order, Store? store, DateTime now) {
  if (order.status == OrderStatus.accepted || order.status == OrderStatus.inProgress) {
    if (now.isAfter(order.dueAt)) return OrderWaitNote.late;
    return order.readyEstimateAt != null ? OrderWaitNote.newEstimate : null;
  }
  if (!isAwaitingAcceptance(order)) return null;
  final closed = store != null && store.openNow == false && store.asapBlockedReason != AsapBlockedReason.queueFull;
  return order.pickupMode == PickupMode.scheduled && closed
      ? OrderWaitNote.preorderAwaitingOpening
      : OrderWaitNote.awaitingAcceptance;
}

/// Why an EXPIRED order ended, as far as the order itself tells. It carries
/// no expiry reason: a released hold shows as no payment, a payment that
/// timed out as a pending or failed one.
enum ExpiredOutcome {
  /// The store never accepted it and nothing was taken.
  notAccepted,

  /// The store never accepted it and the money taken is on its way back.
  notAcceptedRefunded,

  /// The card payment never went through.
  paymentNotCompleted,
}

ExpiredOutcome expiredOutcome(Order order) => switch (order.payment.state) {
  PaymentState.pending || PaymentState.failed => ExpiredOutcome.paymentNotCompleted,
  PaymentState.refunded || PaymentState.paid => ExpiredOutcome.notAcceptedRefunded,
  PaymentState.none || PaymentState.held => ExpiredOutcome.notAccepted,
};

/// Who called a cancelled order off, as the customer reads it. The same
/// rules as the web (`orderCancellation` in `@takeaway/utils`).
enum CancelledParty {
  /// The customer cancelled it themselves.
  customer,

  /// The kitchen turned it down.
  store,

  /// The bank declined the card when the kitchen accepted the order.
  cardDeclined,
}

/// Where the money of a cancelled order is, in the push's words.
enum CancelledMoney {
  /// Nothing was taken from the card.
  notCharged,

  /// The card hold is lifted. The customer cancels only while nothing is
  /// captured, so money given back on their own cancel is always a hold.
  released,

  /// The money is on its way back to the card.
  refunded,

  /// The hold is still on the card and comes off by itself.
  holdPending,
}

/// What the order screen says about a cancelled order.
class OrderCancellation {
  const OrderCancellation({required this.by, required this.reason, required this.comment, required this.money});

  /// Null when the order does not say (cancelled before 2026-11-05).
  final CancelledParty? by;

  /// The kitchen's reason; only when [by] is [CancelledParty.store].
  final OrderCancelReason? reason;

  /// The kitchen's own words, as typed; only when [by] is [CancelledParty.store].
  final String? comment;

  /// Null when there was no card money to speak of.
  final CancelledMoney? money;
}

/// Who called a cancelled order off, why, and where the money is — the
/// story the push told. Null for any other status. The money comes from the
/// order's payment as it is now, like [expiredOutcome].
OrderCancellation? orderCancellation(Order order) {
  if (order.status != OrderStatus.cancelled) return null;
  final by = switch (order.cancelledBy) {
    OrderCanceller.customer => CancelledParty.customer,
    OrderCanceller.store when order.cancelReason == OrderCancelReason.cardDeclined => CancelledParty.cardDeclined,
    OrderCanceller.store => CancelledParty.store,
    null => null,
  };
  final reason = by == CancelledParty.store ? order.cancelReason : null;
  final comment = by == CancelledParty.store ? order.cancelComment?.trim() : null;
  return OrderCancellation(
    by: by,
    reason: reason == OrderCancelReason.unknown ? null : reason,
    comment: comment == null || comment.isEmpty ? null : comment,
    money: switch (order.payment.state) {
      PaymentState.none || PaymentState.failed => order.totalCents == 0 ? null : CancelledMoney.notCharged,
      PaymentState.held => CancelledMoney.holdPending,
      PaymentState.refunded => by == CancelledParty.customer ? CancelledMoney.released : CancelledMoney.refunded,
      PaymentState.paid => CancelledMoney.refunded,
      // The bank has not said yet whether anything was taken.
      PaymentState.pending => null,
    },
  );
}

/// Who cancelled an order in the history list: [OrderSummary] has no
/// payment, so only the party.
CancelledParty? cancelledPartyOf(OrderSummary order) {
  if (order.status != OrderStatus.cancelled) return null;
  return switch (order.cancelledBy) {
    OrderCanceller.customer => CancelledParty.customer,
    OrderCanceller.store when order.cancelReason == OrderCancelReason.cardDeclined => CancelledParty.cardDeclined,
    OrderCanceller.store => CancelledParty.store,
    null => null,
  };
}
