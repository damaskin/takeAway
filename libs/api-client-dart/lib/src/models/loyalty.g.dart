// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'loyalty.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

LoyaltyEntry _$LoyaltyEntryFromJson(Map<String, dynamic> json) => LoyaltyEntry(
  id: json['id'] as String,
  type: json['type'] as String,
  amount: (json['amount'] as num).toInt(),
  reason: json['reason'] as String,
  createdAt: DateTime.parse(json['createdAt'] as String),
  orderId: json['orderId'] as String?,
);

LoyaltyAccount _$LoyaltyAccountFromJson(Map<String, dynamic> json) => LoyaltyAccount(
  userId: json['userId'] as String,
  pointsBalance: (json['pointsBalance'] as num).toInt(),
  lifetimePoints: (json['lifetimePoints'] as num).toInt(),
  tier: $enumDecode(_$LoyaltyTierEnumMap, json['tier'], unknownValue: LoyaltyTier.silver),
  pointsToNextTier: (json['pointsToNextTier'] as num?)?.toInt() ?? 0,
  tierProgressPercent: (json['tierProgressPercent'] as num?)?.toInt() ?? 0,
  recent:
      (json['recent'] as List<dynamic>?)?.map((e) => LoyaltyEntry.fromJson(e as Map<String, dynamic>)).toList() ?? [],
  nextTier: $enumDecodeNullable(
    _$LoyaltyTierEnumMap,
    json['nextTier'],
    unknownValue: JsonKey.nullForUndefinedEnumValue,
  ),
);

const _$LoyaltyTierEnumMap = {
  LoyaltyTier.silver: 'SILVER',
  LoyaltyTier.gold: 'GOLD',
  LoyaltyTier.platinum: 'PLATINUM',
  LoyaltyTier.signature: 'SIGNATURE',
};

RedeemQuote _$RedeemQuoteFromJson(Map<String, dynamic> json) => RedeemQuote(
  points: (json['points'] as num).toInt(),
  discountCents: (json['discountCents'] as num).toInt(),
  balance: (json['balance'] as num).toInt(),
  pointValueCents: (json['pointValueCents'] as num).toInt(),
  minPoints: (json['minPoints'] as num).toInt(),
);

PromoValidation _$PromoValidationFromJson(Map<String, dynamic> json) => PromoValidation(
  valid: json['valid'] as bool,
  discountCents: (json['discountCents'] as num?)?.toInt() ?? 0,
  pointsMultiplier: (json['pointsMultiplier'] as num?)?.toDouble() ?? 1,
  reason: json['reason'] as String?,
);

GiftCardValidation _$GiftCardValidationFromJson(Map<String, dynamic> json) => GiftCardValidation(
  applicableCents: (json['applicableCents'] as num).toInt(),
  remainingCents: (json['remainingCents'] as num).toInt(),
  currency: json['currency'] as String,
);

GiftCardRedemption _$GiftCardRedemptionFromJson(Map<String, dynamic> json) => GiftCardRedemption(
  orderId: json['orderId'] as String,
  orderCode: json['orderCode'] as String,
  code: json['code'] as String,
  amountCents: (json['amountCents'] as num).toInt(),
  currency: json['currency'] as String,
  brandName: json['brandName'] as String,
  createdAt: DateTime.parse(json['createdAt'] as String),
);

ReferralSummary _$ReferralSummaryFromJson(Map<String, dynamic> json) => ReferralSummary(
  code: json['code'] as String,
  signupsCount: (json['signupsCount'] as num?)?.toInt() ?? 0,
  rewardedCount: (json['rewardedCount'] as num?)?.toInt() ?? 0,
  pointsEarned: (json['pointsEarned'] as num?)?.toInt() ?? 0,
  appliedCode: json['appliedCode'] as String?,
);
