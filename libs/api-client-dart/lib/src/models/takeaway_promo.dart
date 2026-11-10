import 'package:json_annotation/json_annotation.dart';

part 'takeaway_promo.g.dart';

// «Акции takeAway» as a customer meets them: percent discounts takeAway
// runs at every venue at its own expense, and the welcome bonus built on
// them (docs/takeaway-promos.md). Every field here is new in 2026-11, so an
// older API simply never sends them.

/// Whose promo code a validated code is: the brand's own (the brand pays)
/// or takeAway's (takeAway compensates the venue, and loyalty points cannot
/// be added to it).
@JsonEnum(alwaysCreate: true)
enum PromoSource {
  @JsonValue('BRAND')
  brand,
  @JsonValue('TAKEAWAY')
  takeaway,
}

/// The takeAway promo behind a valid code, from `POST /promo/validate`.
@JsonSerializable(createToJson: false)
class ValidatedTakeawayPromo {
  const ValidatedTakeawayPromo({
    required this.id,
    required this.code,
    required this.name,
    required this.percent,
    this.isWelcome = false,
  });

  factory ValidatedTakeawayPromo.fromJson(Map<String, dynamic> json) => _$ValidatedTakeawayPromoFromJson(json);

  final String id;
  final String code;

  /// The platform admin's name for it, e.g. «Приветственный бонус».
  final String name;

  /// 1..99.
  final int percent;

  /// The welcome bonus handed out at sign-up, not a code the customer found.
  @JsonKey(defaultValue: false)
  final bool isWelcome;
}

/// A takeAway promo on one order: the guest paid [paidByGuestCents] of
/// [menuTotalCents], takeAway pays the venue [discountCents] (which is also
/// part of the order's `discountCents`).
@JsonSerializable(createToJson: false)
class TakeawayPromoLine {
  const TakeawayPromoLine({
    required this.code,
    required this.name,
    required this.percent,
    required this.menuTotalCents,
    required this.discountCents,
    required this.paidByGuestCents,
  });

  factory TakeawayPromoLine.fromJson(Map<String, dynamic> json) => _$TakeawayPromoLineFromJson(json);

  final String code;
  final String name;
  final int percent;
  @JsonKey(defaultValue: 0)
  final int menuTotalCents;
  @JsonKey(defaultValue: 0)
  final int discountCents;
  @JsonKey(defaultValue: 0)
  final int paidByGuestCents;
}

/// What a bonus of `GET /me/bonuses` is. [unknown] is a kind this build does
/// not know yet.
@JsonEnum(alwaysCreate: true)
enum CustomerBonusKind {
  @JsonValue('WELCOME')
  welcome,
  unknown,
}

/// The customer's unused welcome bonus, from `GET /me/bonuses`: the API
/// lists it only while it is unused, unexpired and its promo still runs.
@JsonSerializable(createToJson: false)
class CustomerBonus {
  const CustomerBonus({
    required this.id,
    required this.kind,
    required this.promoId,
    required this.code,
    required this.name,
    required this.percent,
    required this.currency,
    required this.expiresAt,
  });

  factory CustomerBonus.fromJson(Map<String, dynamic> json) => _$CustomerBonusFromJson(json);

  final String id;
  @JsonKey(unknownEnumValue: CustomerBonusKind.unknown)
  final CustomerBonusKind kind;
  final String promoId;

  /// Goes into the promo field at checkout; the API checks it belongs to
  /// this customer.
  final String code;
  final String name;
  final int percent;

  /// The bonus works only at stores selling in this currency.
  final String currency;
  final DateTime expiresAt;

  bool get isWelcome => kind == CustomerBonusKind.welcome;

  /// Still usable at [now]: the list is read once and may outlive the bonus.
  bool activeAt(DateTime now) => expiresAt.isAfter(now);

  /// Whether a store selling in [storeCurrency] takes it.
  bool worksIn(String storeCurrency) => currency.toUpperCase() == storeCurrency.toUpperCase();
}
