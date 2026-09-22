import 'package:json_annotation/json_annotation.dart';

part 'loyalty.g.dart';

@JsonEnum(alwaysCreate: true)
enum LoyaltyTier {
  @JsonValue('SILVER')
  silver,
  @JsonValue('GOLD')
  gold,
  @JsonValue('PLATINUM')
  platinum,
  @JsonValue('SIGNATURE')
  signature,
}

@JsonSerializable(createToJson: false)
class LoyaltyEntry {
  const LoyaltyEntry({
    required this.id,
    required this.type,
    required this.amount,
    required this.reason,
    required this.createdAt,
    this.orderId,
  });

  factory LoyaltyEntry.fromJson(Map<String, dynamic> json) => _$LoyaltyEntryFromJson(json);

  final String id;

  /// EARN / SPEND / EXPIRE / ADJUST.
  final String type;
  final int amount;
  final String reason;
  final String? orderId;
  final DateTime createdAt;
}

@JsonSerializable(createToJson: false)
class LoyaltyAccount {
  const LoyaltyAccount({
    required this.userId,
    required this.pointsBalance,
    required this.lifetimePoints,
    required this.tier,
    required this.pointsToNextTier,
    required this.tierProgressPercent,
    required this.recent,
    this.nextTier,
  });

  factory LoyaltyAccount.fromJson(Map<String, dynamic> json) => _$LoyaltyAccountFromJson(json);

  final String userId;
  final int pointsBalance;
  final int lifetimePoints;
  @JsonKey(unknownEnumValue: LoyaltyTier.silver)
  final LoyaltyTier tier;
  @JsonKey(unknownEnumValue: JsonKey.nullForUndefinedEnumValue)
  final LoyaltyTier? nextTier;
  @JsonKey(defaultValue: 0)
  final int pointsToNextTier;
  @JsonKey(defaultValue: 0)
  final int tierProgressPercent;
  @JsonKey(defaultValue: <LoyaltyEntry>[])
  final List<LoyaltyEntry> recent;
}

@JsonSerializable(createToJson: false)
class RedeemQuote {
  const RedeemQuote({
    required this.points,
    required this.discountCents,
    required this.balance,
    required this.pointValueCents,
    required this.minPoints,
  });

  factory RedeemQuote.fromJson(Map<String, dynamic> json) => _$RedeemQuoteFromJson(json);

  final int points;
  final int discountCents;
  final int balance;
  final int pointValueCents;
  final int minPoints;
}

@JsonSerializable(createToJson: false)
class PromoValidation {
  const PromoValidation({
    required this.valid,
    required this.discountCents,
    required this.pointsMultiplier,
    this.reason,
  });

  factory PromoValidation.fromJson(Map<String, dynamic> json) => _$PromoValidationFromJson(json);

  final bool valid;
  final String? reason;
  @JsonKey(defaultValue: 0)
  final int discountCents;
  @JsonKey(defaultValue: 1)
  final double pointsMultiplier;
}

@JsonSerializable(createToJson: false)
class GiftCardValidation {
  const GiftCardValidation({required this.applicableCents, required this.remainingCents, required this.currency});

  factory GiftCardValidation.fromJson(Map<String, dynamic> json) => _$GiftCardValidationFromJson(json);

  final int applicableCents;
  final int remainingCents;
  final String currency;
}

@JsonSerializable(createToJson: false)
class GiftCardRedemption {
  const GiftCardRedemption({
    required this.orderId,
    required this.orderCode,
    required this.code,
    required this.amountCents,
    required this.currency,
    required this.brandName,
    required this.createdAt,
  });

  factory GiftCardRedemption.fromJson(Map<String, dynamic> json) => _$GiftCardRedemptionFromJson(json);

  final String orderId;
  final String orderCode;
  final String code;
  final int amountCents;
  final String currency;
  final String brandName;
  final DateTime createdAt;
}

@JsonSerializable(createToJson: false)
class ReferralSummary {
  const ReferralSummary({
    required this.code,
    required this.signupsCount,
    required this.rewardedCount,
    required this.pointsEarned,
    this.appliedCode,
  });

  factory ReferralSummary.fromJson(Map<String, dynamic> json) => _$ReferralSummaryFromJson(json);

  final String code;
  @JsonKey(defaultValue: 0)
  final int signupsCount;
  @JsonKey(defaultValue: 0)
  final int rewardedCount;
  @JsonKey(defaultValue: 0)
  final int pointsEarned;
  final String? appliedCode;
}
