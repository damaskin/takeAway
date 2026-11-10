import 'package:json_annotation/json_annotation.dart';

import 'options.dart';
import 'takeaway_promo.dart';

part 'order.g.dart';

@JsonEnum(alwaysCreate: true)
enum OrderStatus {
  @JsonValue('CREATED')
  created,
  @JsonValue('PAID')
  paid,
  @JsonValue('ACCEPTED')
  accepted,
  @JsonValue('IN_PROGRESS')
  inProgress,
  @JsonValue('READY')
  ready,
  @JsonValue('PICKED_UP')
  pickedUp,
  @JsonValue('OUT_FOR_DELIVERY')
  outForDelivery,
  @JsonValue('DELIVERED')
  delivered,
  @JsonValue('CANCELLED')
  cancelled,
  @JsonValue('EXPIRED')
  expired,
  unknown;

  bool get isTerminal =>
      this == OrderStatus.pickedUp ||
      this == OrderStatus.delivered ||
      this == OrderStatus.cancelled ||
      this == OrderStatus.expired;

  bool get isCancelled => this == OrderStatus.cancelled || this == OrderStatus.expired;

  /// The customer may cancel only before the kitchen accepts the order
  /// (owner decision 2026-10-20); after that they call the store. The API's
  /// own verdict, [Order.canCancel], also knows whether money was taken —
  /// see [Order.customerCanCancel].
  bool get isCancellable => this == OrderStatus.created || this == OrderStatus.paid;

  /// The customer has the order: picked up at the counter or delivered. Only
  /// then may they review it — see [Order.canReview].
  bool get isHandedOver => this == OrderStatus.pickedUp || this == OrderStatus.delivered;

  static OrderStatus parse(String? raw) => _$OrderStatusEnumMap.entries
      .firstWhere((e) => e.value == raw, orElse: () => const MapEntry(OrderStatus.unknown, 'UNKNOWN'))
      .key;
}

@JsonEnum(alwaysCreate: true)
enum PickupMode {
  @JsonValue('ASAP')
  asap,
  @JsonValue('SCHEDULED')
  scheduled,
}

@JsonEnum(alwaysCreate: true)
enum FulfillmentType {
  @JsonValue('PICKUP')
  pickup,
  @JsonValue('DINE_IN')
  dineIn,
  @JsonValue('DELIVERY')
  delivery,
}

/// Who called a cancelled order off.
@JsonEnum(alwaysCreate: true)
enum OrderCanceller {
  @JsonValue('CUSTOMER')
  customer,
  @JsonValue('STORE')
  store,
}

/// Why the store called an order off: the kitchen's reason when it turned
/// the order down, or [cardDeclined] — the bank declined the card when the
/// kitchen accepted it. [unknown] is a reason this build does not know yet.
@JsonEnum(alwaysCreate: true)
enum OrderCancelReason {
  @JsonValue('OUT_OF_STOCK')
  outOfStock,
  @JsonValue('TOO_BUSY')
  tooBusy,
  @JsonValue('CLOSING')
  closing,
  @JsonValue('OTHER')
  other,
  @JsonValue('CARD_DECLINED')
  cardDeclined,
  unknown,
}

/// Where the money of a cancelled or expired order went, recorded by the API
/// when it called the order off — the outcome the push states.
@JsonEnum(alwaysCreate: true)
enum OrderCancelMoney {
  /// Nothing was taken: a charge waiting for the accept was called off, or
  /// the card was declined.
  @JsonValue('NOT_CHARGED')
  notCharged,

  /// The card hold came off.
  @JsonValue('RELEASED')
  released,

  /// A captured charge is on its way back to the card.
  @JsonValue('REFUNDED')
  refunded,

  /// The bank has not let go of the hold (or taken the refund) yet; it
  /// comes off by itself.
  @JsonValue('PENDING')
  pending,
}

@JsonEnum(alwaysCreate: true)
enum PaymentState {
  @JsonValue('NONE')
  none,
  @JsonValue('PENDING')
  pending,
  @JsonValue('HELD')
  held,
  @JsonValue('PAID')
  paid,
  @JsonValue('FAILED')
  failed,
  @JsonValue('REFUNDED')
  refunded,
}

@JsonSerializable(createToJson: false)
class OrderPayment {
  const OrderPayment({required this.state, required this.amountCents, this.cardMask, this.paidAt});

  factory OrderPayment.fromJson(Map<String, dynamic> json) => _$OrderPaymentFromJson(json);

  static const none = OrderPayment(state: PaymentState.none, amountCents: 0);

  @JsonKey(unknownEnumValue: PaymentState.none)
  final PaymentState state;
  final int amountCents;
  final String? cardMask;
  final DateTime? paidAt;
}

@JsonSerializable(createToJson: false)
class OrderItem {
  const OrderItem({
    required this.id,
    required this.productSnapshot,
    required this.quantity,
    required this.unitPriceCents,
    required this.totalCents,
  });

  factory OrderItem.fromJson(Map<String, dynamic> json) => _$OrderItemFromJson(json);

  final String id;
  @JsonKey(defaultValue: <String, dynamic>{})
  final Map<String, dynamic> productSnapshot;
  final int quantity;
  final int unitPriceCents;
  final int totalCents;

  String get name => productSnapshot['name'] is String ? productSnapshot['name'] as String : '—';

  String? get productId => productSnapshot['id'] is String ? productSnapshot['id'] as String : null;

  String? get notes => productSnapshot['notes'] is String ? productSnapshot['notes'] as String : null;

  List<String> get variationIds {
    final raw = productSnapshot['variationIds'];
    return raw is List ? raw.whereType<String>().toList() : const [];
  }

  Map<String, int> get modifiers {
    final raw = productSnapshot['modifiers'];
    if (raw is! Map) return const {};
    final result = <String, int>{};
    raw.forEach((key, value) {
      if (key is String && value is num && value > 0) result[key] = value.toInt();
    });
    return result;
  }

  /// Picks from the options catalog as they were bought, variants first.
  /// Empty on lines of products without catalog groups and on orders placed
  /// before 2026-11-09; lines this build cannot read are left out.
  List<OptionLine> get optionLines => OptionLine.listFrom(productSnapshot['optionLines']);
}

@JsonSerializable(createToJson: false)
class Order {
  const Order({
    required this.id,
    required this.orderCode,
    required this.qrToken,
    required this.status,
    required this.pickupMode,
    required this.fulfillmentType,
    required this.pickupAt,
    required this.subtotalCents,
    required this.discountCents,
    required this.taxCents,
    required this.totalCents,
    required this.currency,
    required this.storeId,
    required this.storeName,
    required this.storeLatitude,
    required this.storeLongitude,
    required this.items,
    required this.createdAt,
    this.storeAddress,
    this.customerName,
    this.customerPhone,
    this.notes,
    this.couponCode,
    this.giftCardCode,
    this.giftCardCents = 0,
    this.acceptedAt,
    this.startedAt,
    this.readyAt,
    this.pickedUpAt,
    this.cancelledAt,
    this.expiredAt,
    this.deliveryAddressLine,
    this.deliveryCity,
    this.deliveryLatitude,
    this.deliveryLongitude,
    this.deliveryNotes,
    this.deliveryFeeCents = 0,
    this.deliveryDistanceM,
    this.riderId,
    this.outForDeliveryAt,
    this.deliveredAt,
    this.payment = OrderPayment.none,
    this.readyEstimateAt,
    this.canCancel,
    this.cancelledBy,
    this.cancelReason,
    this.cancelComment,
    this.cancelMoney,
    this.canReview,
    this.review,
    this.takeawayPromo,
  });

  factory Order.fromJson(Map<String, dynamic> json) => _$OrderFromJson(json);

  final String id;
  final String orderCode;
  final String qrToken;
  @JsonKey(unknownEnumValue: OrderStatus.unknown)
  final OrderStatus status;
  final PickupMode pickupMode;
  @JsonKey(unknownEnumValue: FulfillmentType.pickup)
  final FulfillmentType fulfillmentType;
  final DateTime pickupAt;
  final int subtotalCents;
  @JsonKey(defaultValue: 0)
  final int discountCents;
  @JsonKey(defaultValue: 0)
  final int taxCents;
  final int totalCents;
  final String currency;
  final String storeId;
  final String storeName;
  @JsonKey(defaultValue: 0)
  final double storeLatitude;
  @JsonKey(defaultValue: 0)
  final double storeLongitude;
  final String? storeAddress;
  final String? customerName;
  final String? customerPhone;
  final String? notes;
  final String? couponCode;
  final String? giftCardCode;
  @JsonKey(defaultValue: 0)
  final int giftCardCents;
  @JsonKey(defaultValue: <OrderItem>[])
  final List<OrderItem> items;
  final DateTime createdAt;
  final DateTime? acceptedAt;
  final DateTime? startedAt;
  final DateTime? readyAt;
  final DateTime? pickedUpAt;
  final DateTime? cancelledAt;
  final DateTime? expiredAt;
  final String? deliveryAddressLine;
  final String? deliveryCity;
  final double? deliveryLatitude;
  final double? deliveryLongitude;
  final String? deliveryNotes;
  @JsonKey(defaultValue: 0)
  final int deliveryFeeCents;
  final double? deliveryDistanceM;
  final String? riderId;
  final DateTime? outForDeliveryAt;
  final DateTime? deliveredAt;
  @JsonKey(fromJson: _paymentFromJson)
  final OrderPayment payment;

  /// When the kitchen expects the order ready, set when it accepted or
  /// started the order too late to make [pickupAt]. Null otherwise and from
  /// API versions that predate it. [pickupAt] stays the original promise.
  final DateTime? readyEstimateAt;

  /// The API's verdict on whether the customer may cancel now: not accepted
  /// yet and no money taken. Null from API versions that predate it.
  final bool? canCancel;

  /// Who cancelled a cancelled order. Null otherwise, on orders cancelled
  /// before 2026-11-05 whose record did not say, and from older APIs.
  @JsonKey(unknownEnumValue: JsonKey.nullForUndefinedEnumValue)
  final OrderCanceller? cancelledBy;

  /// Why the store cancelled it; null for the customer's own cancel.
  @JsonKey(unknownEnumValue: OrderCancelReason.unknown)
  final OrderCancelReason? cancelReason;

  /// The kitchen's comment when it turned the order down, shown as is.
  final String? cancelComment;

  /// Where the money of a cancelled or expired order went, as the push said.
  /// Null while the order is live, when there was no card money to speak
  /// of, on older orders the API could not tell, from older APIs, and for a
  /// value this build does not know.
  @JsonKey(unknownEnumValue: JsonKey.nullForUndefinedEnumValue)
  final OrderCancelMoney? cancelMoney;

  /// The API's verdict on whether the customer may review the order now:
  /// handed over and no review yet. Null from API versions that predate
  /// reviews — see [customerCanReview].
  final bool? canReview;

  /// The customer's review, once they left one.
  final OrderReview? review;

  /// The takeAway promo or welcome bonus on the order: its discount is part
  /// of [discountCents], takeAway pays it to the venue. Null without one and
  /// from APIs that predate takeAway promos.
  final TakeawayPromoLine? takeawayPromo;

  /// What the countdown runs to: the kitchen's new estimate once it accepted
  /// or started the order too late, else the promise. The same rule as the
  /// web (`orderDueAt` in `@takeaway/utils`).
  DateTime get dueAt => readyEstimateAt ?? pickupAt;

  /// Whether to offer «Отменить заказ»: the API's [canCancel], or, from an
  /// API that predates it, a status before the kitchen's accept.
  bool get customerCanCancel => canCancel ?? status.isCancellable;

  /// Whether to ask «Как вам заказ?»: only on the API's word, so never from
  /// an API without reviews.
  bool get customerCanReview => canReview ?? false;

  bool get isDelivery => fulfillmentType == FulfillmentType.delivery;
  bool get hasStoreLocation => storeLatitude != 0 || storeLongitude != 0;
  int get itemCount => items.fold(0, (sum, i) => sum + i.quantity);

  Order copyWithStatus(OrderStatus next) => Order(
    id: id,
    orderCode: orderCode,
    qrToken: qrToken,
    status: next,
    pickupMode: pickupMode,
    fulfillmentType: fulfillmentType,
    pickupAt: pickupAt,
    subtotalCents: subtotalCents,
    discountCents: discountCents,
    taxCents: taxCents,
    totalCents: totalCents,
    currency: currency,
    storeId: storeId,
    storeName: storeName,
    storeLatitude: storeLatitude,
    storeLongitude: storeLongitude,
    items: items,
    createdAt: createdAt,
    storeAddress: storeAddress,
    customerName: customerName,
    customerPhone: customerPhone,
    notes: notes,
    couponCode: couponCode,
    giftCardCode: giftCardCode,
    giftCardCents: giftCardCents,
    acceptedAt: acceptedAt,
    startedAt: startedAt,
    readyAt: readyAt,
    pickedUpAt: pickedUpAt,
    cancelledAt: cancelledAt,
    expiredAt: expiredAt,
    deliveryAddressLine: deliveryAddressLine,
    deliveryCity: deliveryCity,
    deliveryLatitude: deliveryLatitude,
    deliveryLongitude: deliveryLongitude,
    deliveryNotes: deliveryNotes,
    deliveryFeeCents: deliveryFeeCents,
    deliveryDistanceM: deliveryDistanceM,
    riderId: riderId,
    outForDeliveryAt: outForDeliveryAt,
    deliveredAt: deliveredAt,
    payment: payment,
    readyEstimateAt: readyEstimateAt,
    // A cancel the order allowed before is off once the kitchen took it.
    canCancel: next.isCancellable ? canCancel : false,
    cancelledBy: cancelledBy,
    cancelReason: cancelReason,
    cancelComment: cancelComment,
    cancelMoney: cancelMoney,
    // Handing over is what opens the review, and the re-read that follows
    // every status change tells; leaving that status closes it at once.
    canReview: next.isHandedOver ? canReview : false,
    review: review,
    takeawayPromo: takeawayPromo,
  );
}

/// Longest review comment the API accepts, after trimming.
const orderReviewCommentMaxLength = 1000;

/// The customer's review of a handed-over order: one per order, never edited,
/// read by the takeAway team only — the brand does not see it.
@JsonSerializable(createToJson: false)
class OrderReview {
  const OrderReview({required this.rating, required this.createdAt, this.comment});

  factory OrderReview.fromJson(Map<String, dynamic> json) => _$OrderReviewFromJson(json);

  /// 1..5 stars.
  final int rating;
  final String? comment;
  final DateTime createdAt;
}

/// Body of `POST /orders/{id}/review`. A blank [comment] is left out; the
/// API trims it too and takes up to [orderReviewCommentMaxLength] characters.
@JsonSerializable(createFactory: false, includeIfNull: false)
class CreateOrderReviewRequest {
  const CreateOrderReviewRequest({required this.rating, this.comment});

  /// 1..5 stars.
  final int rating;
  @JsonKey(toJson: _trimmedOrNull)
  final String? comment;

  Map<String, dynamic> toJson() => _$CreateOrderReviewRequestToJson(this);
}

String? _trimmedOrNull(String? value) {
  final trimmed = value?.trim();
  return trimmed == null || trimmed.isEmpty ? null : trimmed;
}

OrderPayment _paymentFromJson(Object? raw) =>
    raw is Map<String, dynamic> ? OrderPayment.fromJson(raw) : OrderPayment.none;

@JsonSerializable(createToJson: false)
class OrderSummary {
  const OrderSummary({
    required this.id,
    required this.orderCode,
    required this.status,
    required this.pickupMode,
    required this.pickupAt,
    required this.totalCents,
    required this.currency,
    required this.storeId,
    required this.storeName,
    required this.itemCount,
    required this.createdAt,
    this.cancelledBy,
    this.cancelReason,
    this.canReview = false,
    this.reviewRating,
  });

  factory OrderSummary.fromJson(Map<String, dynamic> json) => _$OrderSummaryFromJson(json);

  final String id;
  final String orderCode;
  @JsonKey(unknownEnumValue: OrderStatus.unknown)
  final OrderStatus status;
  final PickupMode pickupMode;
  final DateTime pickupAt;
  final int totalCents;
  final String currency;
  final String storeId;
  final String storeName;
  final int itemCount;
  final DateTime createdAt;

  /// See [Order.cancelledBy].
  @JsonKey(unknownEnumValue: JsonKey.nullForUndefinedEnumValue)
  final OrderCanceller? cancelledBy;

  /// See [Order.cancelReason].
  @JsonKey(unknownEnumValue: OrderCancelReason.unknown)
  final OrderCancelReason? cancelReason;

  /// See [Order.canReview]; false from APIs that predate reviews.
  @JsonKey(defaultValue: false)
  final bool canReview;

  /// The stars of the customer's review, once they left one.
  final int? reviewRating;

  OrderSummary withStatus(OrderStatus next) => OrderSummary(
    id: id,
    orderCode: orderCode,
    status: next,
    pickupMode: pickupMode,
    pickupAt: pickupAt,
    totalCents: totalCents,
    currency: currency,
    storeId: storeId,
    storeName: storeName,
    itemCount: itemCount,
    createdAt: createdAt,
    cancelledBy: cancelledBy,
    cancelReason: cancelReason,
    canReview: next.isHandedOver && canReview,
    reviewRating: reviewRating,
  );
}

@JsonSerializable(createFactory: false, includeIfNull: false)
class CreateOrderRequest {
  const CreateOrderRequest({
    required this.cartId,
    required this.pickupMode,
    this.pickupAt,
    this.fulfillmentType,
    this.customerName,
    this.customerPhone,
    this.notes,
    this.couponCode,
    this.giftCardCode,
    this.pointsToSpend,
    this.deliveryAddressLine,
    this.deliveryCity,
    this.deliveryLatitude,
    this.deliveryLongitude,
    this.deliveryNotes,
  });

  final String cartId;
  final PickupMode pickupMode;
  @JsonKey(toJson: _utcIso)
  final DateTime? pickupAt;
  final FulfillmentType? fulfillmentType;
  final String? customerName;
  final String? customerPhone;
  final String? notes;
  final String? couponCode;
  final String? giftCardCode;
  final int? pointsToSpend;
  final String? deliveryAddressLine;
  final String? deliveryCity;
  final double? deliveryLatitude;
  final double? deliveryLongitude;
  final String? deliveryNotes;

  Map<String, dynamic> toJson() => _$CreateOrderRequestToJson(this);
}

String? _utcIso(DateTime? value) => value?.toUtc().toIso8601String();

@JsonSerializable(createToJson: false)
class CustomerLocationResult {
  const CustomerLocationResult({required this.level, required this.distanceM, required this.recorded});

  factory CustomerLocationResult.fromJson(Map<String, dynamic> json) => _$CustomerLocationResultFromJson(json);

  /// FAR / NEARBY / HERE.
  final String level;
  final double distanceM;
  final bool recorded;
}

/// Payload of the `order.statusChanged` socket event.
class OrderStatusEvent {
  const OrderStatusEvent({required this.orderId, required this.status, required this.etaSeconds});

  factory OrderStatusEvent.fromJson(Map<String, dynamic> json) => OrderStatusEvent(
    orderId: json['orderId'] as String? ?? '',
    status: OrderStatus.parse(json['status'] as String?),
    etaSeconds: (json['etaSeconds'] as num?)?.toInt() ?? 0,
  );

  final String orderId;
  final OrderStatus status;
  final int etaSeconds;
}
