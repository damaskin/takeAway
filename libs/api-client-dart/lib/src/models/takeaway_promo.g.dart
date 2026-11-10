// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'takeaway_promo.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

ValidatedTakeawayPromo _$ValidatedTakeawayPromoFromJson(Map<String, dynamic> json) => ValidatedTakeawayPromo(
  id: json['id'] as String,
  code: json['code'] as String,
  name: json['name'] as String,
  percent: (json['percent'] as num).toInt(),
  isWelcome: json['isWelcome'] as bool? ?? false,
);

TakeawayPromoLine _$TakeawayPromoLineFromJson(Map<String, dynamic> json) => TakeawayPromoLine(
  code: json['code'] as String,
  name: json['name'] as String,
  percent: (json['percent'] as num).toInt(),
  menuTotalCents: (json['menuTotalCents'] as num?)?.toInt() ?? 0,
  discountCents: (json['discountCents'] as num?)?.toInt() ?? 0,
  paidByGuestCents: (json['paidByGuestCents'] as num?)?.toInt() ?? 0,
);

CustomerBonus _$CustomerBonusFromJson(Map<String, dynamic> json) => CustomerBonus(
  id: json['id'] as String,
  kind: $enumDecode(_$CustomerBonusKindEnumMap, json['kind'], unknownValue: CustomerBonusKind.unknown),
  promoId: json['promoId'] as String,
  code: json['code'] as String,
  name: json['name'] as String,
  percent: (json['percent'] as num).toInt(),
  currency: json['currency'] as String,
  expiresAt: DateTime.parse(json['expiresAt'] as String),
);

const _$CustomerBonusKindEnumMap = {CustomerBonusKind.welcome: 'WELCOME', CustomerBonusKind.unknown: 'unknown'};

const _$PromoSourceEnumMap = {PromoSource.brand: 'BRAND', PromoSource.takeaway: 'TAKEAWAY'};
