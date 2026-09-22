import 'package:json_annotation/json_annotation.dart';

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

  /// The API lets the customer cancel until the kitchen starts cooking.
  bool get isCancellable => this == OrderStatus.created || this == OrderStatus.paid || this == OrderStatus.accepted;

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
  );
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
