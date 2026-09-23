import 'package:json_annotation/json_annotation.dart';

part 'cart.g.dart';

@JsonSerializable(createToJson: false)
class CartItem {
  const CartItem({
    required this.id,
    required this.productId,
    required this.productName,
    required this.quantity,
    required this.variationIds,
    required this.modifiers,
    required this.unitPriceCents,
    required this.unitPrepSeconds,
    this.notes,
  });

  factory CartItem.fromJson(Map<String, dynamic> json) => _$CartItemFromJson(json);

  final String id;
  final String productId;
  final String productName;
  final int quantity;
  @JsonKey(defaultValue: <String>[])
  final List<String> variationIds;
  @JsonKey(fromJson: _modifierCounts)
  final Map<String, int> modifiers;
  final int unitPriceCents;
  @JsonKey(defaultValue: 0)
  final int unitPrepSeconds;
  final String? notes;

  int get lineTotalCents => unitPriceCents * quantity;
}

@JsonSerializable(createToJson: false)
class Cart {
  const Cart({
    required this.id,
    required this.userId,
    required this.storeId,
    required this.subtotalCents,
    required this.etaSeconds,
    required this.items,
    required this.updatedAt,
  });

  factory Cart.fromJson(Map<String, dynamic> json) => _$CartFromJson(json);

  final String id;
  final String userId;
  final String storeId;
  final int subtotalCents;
  @JsonKey(defaultValue: 0)
  final int etaSeconds;
  @JsonKey(defaultValue: <CartItem>[])
  final List<CartItem> items;
  final DateTime updatedAt;

  bool get isEmpty => items.isEmpty;
  int get itemCount => items.fold(0, (sum, i) => sum + i.quantity);
}

@JsonSerializable(createFactory: false, includeIfNull: false)
class AddCartItemRequest {
  const AddCartItemRequest({
    required this.storeId,
    required this.productId,
    required this.quantity,
    this.variationIds,
    this.modifiers,
    this.notes,
  });

  final String storeId;
  final String productId;
  final int quantity;
  final List<String>? variationIds;
  final Map<String, int>? modifiers;
  final String? notes;

  Map<String, dynamic> toJson() => _$AddCartItemRequestToJson(this);
}

/// Modifier counts arrive as `{ modifierId: count }` where count is a JSON
/// number — tolerate doubles and junk rather than failing the whole cart.
Map<String, int> _modifierCounts(Object? raw) {
  if (raw is! Map) return const {};
  final result = <String, int>{};
  raw.forEach((key, value) {
    if (key is String && value is num) result[key] = value.toInt();
  });
  return result;
}
