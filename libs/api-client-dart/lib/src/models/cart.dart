import 'package:json_annotation/json_annotation.dart';

import 'options.dart';

part 'cart.g.dart';

@JsonSerializable(createToJson: false)
class CartItem {
  const CartItem({
    required this.id,
    required this.productId,
    required this.productName,
    required this.quantity,
    required this.unitPriceCents,
    required this.unitPrepSeconds,
    this.notes,
    this.options = const [],
  });

  factory CartItem.fromJson(Map<String, dynamic> json) => _$CartItemFromJson(json);

  final String id;
  final String productId;
  final String productName;
  final int quantity;

  /// Picks from the options catalog, with names and prices, in page order.
  /// The older options' `variationIds` and `modifiers`, still sent empty for
  /// older app builds, are not read (deleted on 2026-11-18).
  @JsonKey(fromJson: OptionLine.listFrom)
  final List<OptionLine> options;
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

@JsonSerializable(createFactory: false, includeIfNull: false, explicitToJson: true)
class AddCartItemRequest {
  const AddCartItemRequest({
    required this.storeId,
    required this.productId,
    required this.quantity,
    this.options,
    this.notes,
  });

  final String storeId;
  final String productId;
  final int quantity;

  /// Picks from the options catalog. Left out, the API takes every default
  /// (and refuses the add with 400 `OPTIONS_REQUIRED` when that is not a
  /// valid choice).
  final List<OptionSelection>? options;
  final String? notes;

  Map<String, dynamic> toJson() => _$AddCartItemRequestToJson(this);
}

/// Body of `PATCH /cart/items/{itemId}`: what to change, the rest left out.
@JsonSerializable(createFactory: false, includeIfNull: false, explicitToJson: true)
class UpdateCartItemRequest {
  const UpdateCartItemRequest({this.quantity, this.options, this.notes});

  final int? quantity;

  /// See [AddCartItemRequest.options].
  final List<OptionSelection>? options;
  final String? notes;

  Map<String, dynamic> toJson() => _$UpdateCartItemRequestToJson(this);
}
