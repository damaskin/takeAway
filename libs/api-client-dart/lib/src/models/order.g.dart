// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'order.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

OrderPayment _$OrderPaymentFromJson(Map<String, dynamic> json) => OrderPayment(
  state: $enumDecode(_$PaymentStateEnumMap, json['state'], unknownValue: PaymentState.none),
  amountCents: (json['amountCents'] as num).toInt(),
  cardMask: json['cardMask'] as String?,
  paidAt: json['paidAt'] == null ? null : DateTime.parse(json['paidAt'] as String),
);

const _$PaymentStateEnumMap = {
  PaymentState.none: 'NONE',
  PaymentState.pending: 'PENDING',
  PaymentState.held: 'HELD',
  PaymentState.paid: 'PAID',
  PaymentState.failed: 'FAILED',
  PaymentState.refunded: 'REFUNDED',
};

OrderItem _$OrderItemFromJson(Map<String, dynamic> json) => OrderItem(
  id: json['id'] as String,
  productSnapshot: json['productSnapshot'] as Map<String, dynamic>? ?? {},
  quantity: (json['quantity'] as num).toInt(),
  unitPriceCents: (json['unitPriceCents'] as num).toInt(),
  totalCents: (json['totalCents'] as num).toInt(),
);

Order _$OrderFromJson(Map<String, dynamic> json) => Order(
  id: json['id'] as String,
  orderCode: json['orderCode'] as String,
  qrToken: json['qrToken'] as String,
  status: $enumDecode(_$OrderStatusEnumMap, json['status'], unknownValue: OrderStatus.unknown),
  pickupMode: $enumDecode(_$PickupModeEnumMap, json['pickupMode']),
  fulfillmentType: $enumDecode(_$FulfillmentTypeEnumMap, json['fulfillmentType'], unknownValue: FulfillmentType.pickup),
  pickupAt: DateTime.parse(json['pickupAt'] as String),
  subtotalCents: (json['subtotalCents'] as num).toInt(),
  discountCents: (json['discountCents'] as num?)?.toInt() ?? 0,
  taxCents: (json['taxCents'] as num?)?.toInt() ?? 0,
  totalCents: (json['totalCents'] as num).toInt(),
  currency: json['currency'] as String,
  storeId: json['storeId'] as String,
  storeName: json['storeName'] as String,
  storeLatitude: (json['storeLatitude'] as num?)?.toDouble() ?? 0,
  storeLongitude: (json['storeLongitude'] as num?)?.toDouble() ?? 0,
  items: (json['items'] as List<dynamic>?)?.map((e) => OrderItem.fromJson(e as Map<String, dynamic>)).toList() ?? [],
  createdAt: DateTime.parse(json['createdAt'] as String),
  storeAddress: json['storeAddress'] as String?,
  customerName: json['customerName'] as String?,
  customerPhone: json['customerPhone'] as String?,
  notes: json['notes'] as String?,
  couponCode: json['couponCode'] as String?,
  giftCardCode: json['giftCardCode'] as String?,
  giftCardCents: (json['giftCardCents'] as num?)?.toInt() ?? 0,
  acceptedAt: json['acceptedAt'] == null ? null : DateTime.parse(json['acceptedAt'] as String),
  startedAt: json['startedAt'] == null ? null : DateTime.parse(json['startedAt'] as String),
  readyAt: json['readyAt'] == null ? null : DateTime.parse(json['readyAt'] as String),
  pickedUpAt: json['pickedUpAt'] == null ? null : DateTime.parse(json['pickedUpAt'] as String),
  cancelledAt: json['cancelledAt'] == null ? null : DateTime.parse(json['cancelledAt'] as String),
  expiredAt: json['expiredAt'] == null ? null : DateTime.parse(json['expiredAt'] as String),
  deliveryAddressLine: json['deliveryAddressLine'] as String?,
  deliveryCity: json['deliveryCity'] as String?,
  deliveryLatitude: (json['deliveryLatitude'] as num?)?.toDouble(),
  deliveryLongitude: (json['deliveryLongitude'] as num?)?.toDouble(),
  deliveryNotes: json['deliveryNotes'] as String?,
  deliveryFeeCents: (json['deliveryFeeCents'] as num?)?.toInt() ?? 0,
  deliveryDistanceM: (json['deliveryDistanceM'] as num?)?.toDouble(),
  riderId: json['riderId'] as String?,
  outForDeliveryAt: json['outForDeliveryAt'] == null ? null : DateTime.parse(json['outForDeliveryAt'] as String),
  deliveredAt: json['deliveredAt'] == null ? null : DateTime.parse(json['deliveredAt'] as String),
  payment: json['payment'] == null ? OrderPayment.none : _paymentFromJson(json['payment']),
);

const _$OrderStatusEnumMap = {
  OrderStatus.created: 'CREATED',
  OrderStatus.paid: 'PAID',
  OrderStatus.accepted: 'ACCEPTED',
  OrderStatus.inProgress: 'IN_PROGRESS',
  OrderStatus.ready: 'READY',
  OrderStatus.pickedUp: 'PICKED_UP',
  OrderStatus.outForDelivery: 'OUT_FOR_DELIVERY',
  OrderStatus.delivered: 'DELIVERED',
  OrderStatus.cancelled: 'CANCELLED',
  OrderStatus.expired: 'EXPIRED',
  OrderStatus.unknown: 'unknown',
};

const _$PickupModeEnumMap = {PickupMode.asap: 'ASAP', PickupMode.scheduled: 'SCHEDULED'};

const _$FulfillmentTypeEnumMap = {
  FulfillmentType.pickup: 'PICKUP',
  FulfillmentType.dineIn: 'DINE_IN',
  FulfillmentType.delivery: 'DELIVERY',
};

OrderSummary _$OrderSummaryFromJson(Map<String, dynamic> json) => OrderSummary(
  id: json['id'] as String,
  orderCode: json['orderCode'] as String,
  status: $enumDecode(_$OrderStatusEnumMap, json['status'], unknownValue: OrderStatus.unknown),
  pickupMode: $enumDecode(_$PickupModeEnumMap, json['pickupMode']),
  pickupAt: DateTime.parse(json['pickupAt'] as String),
  totalCents: (json['totalCents'] as num).toInt(),
  currency: json['currency'] as String,
  storeId: json['storeId'] as String,
  storeName: json['storeName'] as String,
  itemCount: (json['itemCount'] as num).toInt(),
  createdAt: DateTime.parse(json['createdAt'] as String),
);

Map<String, dynamic> _$CreateOrderRequestToJson(CreateOrderRequest instance) => <String, dynamic>{
  'cartId': instance.cartId,
  'pickupMode': _$PickupModeEnumMap[instance.pickupMode]!,
  'pickupAt': ?_utcIso(instance.pickupAt),
  'fulfillmentType': ?_$FulfillmentTypeEnumMap[instance.fulfillmentType],
  'customerName': ?instance.customerName,
  'customerPhone': ?instance.customerPhone,
  'notes': ?instance.notes,
  'couponCode': ?instance.couponCode,
  'giftCardCode': ?instance.giftCardCode,
  'pointsToSpend': ?instance.pointsToSpend,
  'deliveryAddressLine': ?instance.deliveryAddressLine,
  'deliveryCity': ?instance.deliveryCity,
  'deliveryLatitude': ?instance.deliveryLatitude,
  'deliveryLongitude': ?instance.deliveryLongitude,
  'deliveryNotes': ?instance.deliveryNotes,
};

CustomerLocationResult _$CustomerLocationResultFromJson(Map<String, dynamic> json) => CustomerLocationResult(
  level: json['level'] as String,
  distanceM: (json['distanceM'] as num).toDouble(),
  recorded: json['recorded'] as bool,
);
