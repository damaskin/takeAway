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
