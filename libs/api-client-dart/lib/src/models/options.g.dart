// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'options.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ProductOptionItem _$ProductOptionItemFromJson(Map<String, dynamic> json) => ProductOptionItem(
  id: json['id'] as String,
  name: json['name'] as String,
  note: _textOrNull(json['note']),
  isDefault: json['isDefault'] as bool? ?? false,
  minQty: (json['minQty'] as num?)?.toInt(),
  maxQty: (json['maxQty'] as num?)?.toInt(),
  defaultQty: (json['defaultQty'] as num?)?.toInt(),
  priceCents: (json['priceCents'] as num?)?.toInt() ?? 0,
  available: json['available'] as bool? ?? true,
  sortOrder: (json['sortOrder'] as num?)?.toInt() ?? 0,
);

Map<String, dynamic> _$ProductOptionItemToJson(ProductOptionItem instance) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'note': instance.note,
  'isDefault': instance.isDefault,
  'minQty': instance.minQty,
  'maxQty': instance.maxQty,
  'defaultQty': instance.defaultQty,
  'priceCents': instance.priceCents,
  'available': instance.available,
  'sortOrder': instance.sortOrder,
};

ProductOptionGroup _$ProductOptionGroupFromJson(Map<String, dynamic> json) => ProductOptionGroup(
  id: json['id'] as String,
  kind: $enumDecode(_$OptionGroupKindEnumMap, json['kind'], unknownValue: OptionGroupKind.unknown),
  type: $enumDecode(_$OptionGroupTypeEnumMap, json['type'], unknownValue: OptionGroupType.unknown),
  name: json['name'] as String,
  options: _optionItemsFromJson(json['options']),
  minSelect: (json['minSelect'] as num?)?.toInt(),
  maxSelect: (json['maxSelect'] as num?)?.toInt(),
  showIfOptionId: _textOrNull(json['showIfOptionId']),
);

Map<String, dynamic> _$ProductOptionGroupToJson(ProductOptionGroup instance) => <String, dynamic>{
  'id': instance.id,
  'kind': _$OptionGroupKindEnumMap[instance.kind]!,
  'type': _$OptionGroupTypeEnumMap[instance.type]!,
  'name': instance.name,
  'minSelect': instance.minSelect,
  'maxSelect': instance.maxSelect,
  'showIfOptionId': instance.showIfOptionId,
  'options': instance.options.map((e) => e.toJson()).toList(),
};

const _$OptionGroupKindEnumMap = {
  OptionGroupKind.variant: 'VARIANT',
  OptionGroupKind.addon: 'ADDON',
  OptionGroupKind.unknown: 'unknown',
};

const _$OptionGroupTypeEnumMap = {
  OptionGroupType.a: 'A',
  OptionGroupType.b: 'B',
  OptionGroupType.c: 'C',
  OptionGroupType.d: 'D',
  OptionGroupType.unknown: 'unknown',
};

OptionSelection _$OptionSelectionFromJson(Map<String, dynamic> json) =>
    OptionSelection(optionId: json['optionId'] as String, qty: (json['qty'] as num).toInt());

Map<String, dynamic> _$OptionSelectionToJson(OptionSelection instance) => <String, dynamic>{
  'optionId': instance.optionId,
  'qty': instance.qty,
};

OptionPickError _$OptionPickErrorFromJson(Map<String, dynamic> json) => OptionPickError(
  $enumDecode(_$OptionPickErrorCodeEnumMap, json['code'], unknownValue: OptionPickErrorCode.unknown),
  groupId: json['groupId'] as String?,
  optionId: json['optionId'] as String?,
);

const _$OptionPickErrorCodeEnumMap = {
  OptionPickErrorCode.unknownOption: 'UNKNOWN_OPTION',
  OptionPickErrorCode.optionUnavailable: 'OPTION_UNAVAILABLE',
  OptionPickErrorCode.hiddenGroup: 'HIDDEN_GROUP',
  OptionPickErrorCode.badQty: 'BAD_QTY',
  OptionPickErrorCode.tooFew: 'TOO_FEW',
  OptionPickErrorCode.tooMany: 'TOO_MANY',
  OptionPickErrorCode.unknown: 'unknown',
};
