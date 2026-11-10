import 'package:json_annotation/json_annotation.dart';

part 'options.g.dart';

// The options catalog («Добавки и варианты», Maxim's list 5.0 item 17): one
// platform-wide catalog of option groups a brand attaches to its products.
// Mirrors `libs/shared-types/src/lib/option-groups.ts`; the rules live in
// `../option_groups.dart`. See `docs/option-groups.md`.

/// - [variant] changes the product itself and its price: size, serving, base,
///   meat. A product with a variant group cannot be added without picking.
/// - [addon] goes on top of the picked variant: milk, syrup, sugar, «Без лука».
@JsonEnum(alwaysCreate: true)
enum OptionGroupKind {
  @JsonValue('VARIANT')
  variant,
  @JsonValue('ADDON')
  addon,
  unknown;

  /// [raw] as the API spells it; null for anything this build does not know.
  static OptionGroupKind? parse(Object? raw) {
    for (final entry in _$OptionGroupKindEnumMap.entries) {
      if (entry.key != unknown && entry.value == raw) return entry.key;
    }
    return null;
  }
}

/// - [a] — pick from a list: one (radio) when `maxSelect` is 1, several up to
///   `maxSelect` (checkboxes) otherwise, at least `minSelect`;
/// - [b] — a yes/no switch on every option;
/// - [c] — a −/+ counter on every option, `minQty`…`maxQty`, starting at
///   `defaultQty`; 0 = left out;
/// - [d] — reserved, never created (the API refuses it).
@JsonEnum(alwaysCreate: true)
enum OptionGroupType {
  @JsonValue('A')
  a,
  @JsonValue('B')
  b,
  @JsonValue('C')
  c,
  @JsonValue('D')
  d,
  unknown;

  /// [raw] as the API spells it; null for anything this build does not know.
  static OptionGroupType? parse(Object? raw) {
    for (final entry in _$OptionGroupTypeEnumMap.entries) {
      if (entry.key != unknown && entry.value == raw) return entry.key;
    }
    return null;
  }
}

/// Highest count a C option may allow.
const optionMaxQtyLimit = 20;

/// One option of a group as a store's customers see it.
@JsonSerializable(explicitToJson: true)
class ProductOptionItem {
  const ProductOptionItem({
    required this.id,
    required this.name,
    this.note,
    this.isDefault = false,
    this.minQty,
    this.maxQty,
    this.defaultQty,
    this.priceCents = 0,
    this.available = true,
    this.sortOrder = 0,
  });

  factory ProductOptionItem.fromJson(Map<String, dynamic> json) => _$ProductOptionItemFromJson(json);

  Map<String, dynamic> toJson() => _$ProductOptionItemToJson(this);

  final String id;
  final String name;

  /// Second line under the name («300–350 мл»), or null.
  @JsonKey(fromJson: _textOrNull)
  final String? note;

  /// A and B: picked when the product page opens. C: see [defaultQty]. The
  /// product's own default wins over the catalog's (a dish's signature sauce).
  @JsonKey(defaultValue: false)
  final bool isDefault;

  /// C only (null otherwise): the counter's bounds and starting value.
  final int? minQty;
  final int? maxQty;
  final int? defaultQty;

  /// In the store's currency, minor units.
  /// - VARIANT: what picking it adds to the product's base price (may be < 0);
  /// - ADDON A/B: its price, one for the whole brand;
  /// - ADDON C: the price of one unit above [defaultQty].
  @JsonKey(defaultValue: 0)
  final int priceCents;

  /// False while the store has run out of it: shown greyed out with «Нет в
  /// наличии», cannot be picked.
  @JsonKey(defaultValue: true)
  final bool available;
  @JsonKey(defaultValue: 0)
  final int sortOrder;
}

/// One catalog group attached to a product, as a store's customers see it.
@JsonSerializable(explicitToJson: true)
class ProductOptionGroup {
  const ProductOptionGroup({
    required this.id,
    required this.kind,
    required this.type,
    required this.name,
    required this.options,
    this.minSelect,
    this.maxSelect,
    this.showIfOptionId,
  });

  factory ProductOptionGroup.fromJson(Map<String, dynamic> json) => _$ProductOptionGroupFromJson(json);

  /// A group this build can show, or null: not an object, a field missing or
  /// mistyped, a kind or type it does not know (and the reserved D), or no
  /// options left.
  static ProductOptionGroup? tryParse(Object? raw) {
    if (raw is! Map<String, dynamic>) return null;
    try {
      final group = ProductOptionGroup.fromJson(raw);
      if (group.kind == OptionGroupKind.unknown) return null;
      if (group.type != OptionGroupType.a && group.type != OptionGroupType.b && group.type != OptionGroupType.c) {
        return null;
      }
      return group.options.isEmpty ? null : group;
    } on Object {
      return null;
    }
  }

  /// A product's catalog groups, the ones this build can show (see
  /// [tryParse]); missing (an API that predates the catalog) is none.
  static List<ProductOptionGroup> listFrom(Object? raw) =>
      raw is List ? [for (final entry in raw) ?ProductOptionGroup.tryParse(entry)] : const [];

  Map<String, dynamic> toJson() => _$ProductOptionGroupToJson(this);

  final String id;
  @JsonKey(unknownEnumValue: OptionGroupKind.unknown)
  final OptionGroupKind kind;

  /// Never [OptionGroupType.d].
  @JsonKey(unknownEnumValue: OptionGroupType.unknown)
  final OptionGroupType type;
  final String name;

  /// A only (null for B and C): how many options may be picked. A VARIANT
  /// group always asks for at least one, whatever [minSelect] says.
  final int? minSelect;
  final int? maxSelect;

  /// Shown only while this option is picked (iced coffee → «Лёд»), when that
  /// option's group is on the product; when it is not, the group is always
  /// shown.
  @JsonKey(fromJson: _textOrNull)
  final String? showIfOptionId;

  /// Options the brand offers, in catalog order.
  @JsonKey(fromJson: _optionItemsFromJson)
  final List<ProductOptionItem> options;

  bool get isVariant => kind == OptionGroupKind.variant;
}

/// One pick: an option and how many of it (1 for A and B).
@JsonSerializable()
class OptionSelection {
  const OptionSelection({required this.optionId, required this.qty});

  factory OptionSelection.fromJson(Map<String, dynamic> json) => _$OptionSelectionFromJson(json);

  Map<String, dynamic> toJson() => _$OptionSelectionToJson(this);

  final String optionId;
  final int qty;

  @override
  bool operator ==(Object other) => other is OptionSelection && other.optionId == optionId && other.qty == qty;

  @override
  int get hashCode => Object.hash(optionId, qty);

  @override
  String toString() => 'OptionSelection($optionId, $qty)';
}

/// One picked option in a cart line or an order snapshot, with the names and
/// price as they were when it was picked.
class OptionLine {
  const OptionLine({
    required this.groupId,
    required this.groupName,
    required this.kind,
    required this.type,
    required this.optionId,
    required this.name,
    required this.qty,
    required this.unitPriceCents,
    required this.freeQty,
    required this.totalCents,
  });

  /// A line this build can read, or null — read without trusting its shape,
  /// like the web's `readOrderItemSnapshot`: it needs an option id, a name, a
  /// positive count and a known kind and type; the rest defaults.
  static OptionLine? tryParse(Object? raw) {
    if (raw is! Map) return null;
    final optionId = raw['optionId'];
    final name = raw['name'];
    final qty = raw['qty'];
    if (optionId is! String || name is! String) return null;
    if (qty is! num || !qty.isFinite || qty < 1) return null;
    final kind = OptionGroupKind.parse(raw['kind']);
    final type = OptionGroupType.parse(raw['type']);
    if (kind == null || type == null) return null;
    return OptionLine(
      groupId: raw['groupId'] is String ? raw['groupId'] as String : '',
      groupName: raw['groupName'] is String ? raw['groupName'] as String : '',
      kind: kind,
      type: type,
      optionId: optionId,
      name: name,
      qty: qty.toInt(),
      unitPriceCents: _intOr(raw['unitPriceCents'], 0),
      freeQty: _intOr(raw['freeQty'], 0),
      totalCents: _intOr(raw['totalCents'], 0),
    );
  }

  /// The lines of [raw] this build can read; anything but a list is none.
  static List<OptionLine> listFrom(Object? raw) =>
      raw is List ? [for (final entry in raw) ?OptionLine.tryParse(entry)] : const [];

  Map<String, dynamic> toJson() => {
    'groupId': groupId,
    'groupName': groupName,
    'kind': _$OptionGroupKindEnumMap[kind],
    'type': _$OptionGroupTypeEnumMap[type],
    'optionId': optionId,
    'name': name,
    'qty': qty,
    'unitPriceCents': unitPriceCents,
    'freeQty': freeQty,
    'totalCents': totalCents,
  };

  final String groupId;
  final String groupName;
  final OptionGroupKind kind;
  final OptionGroupType type;
  final String optionId;
  final String name;
  final int qty;

  /// See [ProductOptionItem.priceCents].
  final int unitPriceCents;

  /// C only: the units included in the price. 0 for A and B.
  final int freeQty;

  /// What it adds to one item: [unitPriceCents] for A/B,
  /// `unitPriceCents × max(0, qty − freeQty)` for C.
  final int totalCents;

  /// The pick as the cart takes it back (undo, reorder).
  OptionSelection get selection => OptionSelection(optionId: optionId, qty: qty);

  @override
  String toString() => 'OptionLine($optionId ×$qty, $totalCents)';
}

/// Why a choice cannot go in the cart.
@JsonEnum(alwaysCreate: true)
enum OptionPickErrorCode {
  /// The option is not offered on this product.
  @JsonValue('UNKNOWN_OPTION')
  unknownOption,

  /// The store has run out of it.
  @JsonValue('OPTION_UNAVAILABLE')
  optionUnavailable,

  /// Its group is hidden by its condition (ice without «Холодный»).
  @JsonValue('HIDDEN_GROUP')
  hiddenGroup,

  /// Not a whole number, or more than 1 of an A or B option.
  @JsonValue('BAD_QTY')
  badQty,

  /// Fewer picks than the group asks for — a variant not chosen, too little meat.
  @JsonValue('TOO_FEW')
  tooFew,

  /// More picks than the group allows — a third syrup, a fourth sugar.
  @JsonValue('TOO_MANY')
  tooMany,
  unknown,
}

@JsonSerializable(createToJson: false)
class OptionPickError {
  const OptionPickError(this.code, {this.groupId, this.optionId});

  factory OptionPickError.fromJson(Map<String, dynamic> json) => _$OptionPickErrorFromJson(json);

  @JsonKey(unknownEnumValue: OptionPickErrorCode.unknown)
  final OptionPickErrorCode code;
  final String? groupId;
  final String? optionId;

  @override
  bool operator ==(Object other) =>
      other is OptionPickError && other.code == code && other.groupId == groupId && other.optionId == optionId;

  @override
  int get hashCode => Object.hash(code, groupId, optionId);

  @override
  String toString() => 'OptionPickError(${code.name}, $groupId, $optionId)';
}

/// Body of the 400 the cart answers for a product with catalog groups:
/// - `OPTIONS_REQUIRED` — the request carried no `options` and the defaults
///   are not a valid choice;
/// - `OPTIONS_INVALID` — the choice breaks a rule; [errors] says which.
class OptionsErrorBody {
  const OptionsErrorBody({required this.code, required this.errors, this.message});

  static const codeRequired = 'OPTIONS_REQUIRED';
  static const codeInvalid = 'OPTIONS_INVALID';

  /// The body when it is one of these two, else null. Errors this build
  /// cannot read are left out.
  static OptionsErrorBody? tryParse(Object? body) {
    if (body is! Map) return null;
    final code = body['code'];
    if (code != codeRequired && code != codeInvalid) return null;
    final raw = body['errors'];
    return OptionsErrorBody(
      code: code as String,
      message: body['message'] is String ? body['message'] as String : null,
      errors: raw is List
          ? [
              for (final entry in raw)
                if (entry is Map<String, dynamic>) ?_pickError(entry),
            ]
          : const [],
    );
  }

  final String code;
  final String? message;
  final List<OptionPickError> errors;

  bool get isRequired => code == codeRequired;

  /// The first reason, as the API answers with the first one.
  OptionPickErrorCode? get firstReason => errors.isEmpty ? null : errors.first.code;
}

OptionPickError? _pickError(Map<String, dynamic> json) {
  try {
    return OptionPickError.fromJson(json);
  } on Object {
    return null;
  }
}

List<ProductOptionItem> _optionItemsFromJson(Object? raw) {
  if (raw is! List) return const [];
  final items = <ProductOptionItem>[];
  for (final entry in raw) {
    if (entry is! Map<String, dynamic>) continue;
    try {
      items.add(ProductOptionItem.fromJson(entry));
    } on Object {
      // An option this build cannot read is left out, not the whole product.
    }
  }
  return items;
}

String? _textOrNull(Object? raw) => raw is String && raw.trim().isNotEmpty ? raw.trim() : null;

int _intOr(Object? raw, int fallback) => raw is num && raw.isFinite ? raw.toInt() : fallback;
