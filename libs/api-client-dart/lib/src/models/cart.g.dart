// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'cart.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CartItem _$CartItemFromJson(Map<String, dynamic> json) => CartItem(
  id: json['id'] as String,
  productId: json['productId'] as String,
  productName: json['productName'] as String,
  quantity: (json['quantity'] as num).toInt(),
  variationIds: (json['variationIds'] as List<dynamic>?)?.map((e) => e as String).toList() ?? [],
  modifiers: _modifierCounts(json['modifiers']),
  unitPriceCents: (json['unitPriceCents'] as num).toInt(),
  unitPrepSeconds: (json['unitPrepSeconds'] as num?)?.toInt() ?? 0,
  notes: json['notes'] as String?,
);

Cart _$CartFromJson(Map<String, dynamic> json) => Cart(
  id: json['id'] as String,
  userId: json['userId'] as String,
  storeId: json['storeId'] as String,
  subtotalCents: (json['subtotalCents'] as num).toInt(),
  etaSeconds: (json['etaSeconds'] as num?)?.toInt() ?? 0,
  items: (json['items'] as List<dynamic>?)?.map((e) => CartItem.fromJson(e as Map<String, dynamic>)).toList() ?? [],
  updatedAt: DateTime.parse(json['updatedAt'] as String),
);

Map<String, dynamic> _$AddCartItemRequestToJson(AddCartItemRequest instance) => <String, dynamic>{
  'storeId': instance.storeId,
  'productId': instance.productId,
  'quantity': instance.quantity,
  'variationIds': ?instance.variationIds,
  'modifiers': ?instance.modifiers,
  'notes': ?instance.notes,
};
