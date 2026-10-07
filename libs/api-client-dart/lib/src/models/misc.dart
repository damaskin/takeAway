import 'package:json_annotation/json_annotation.dart';

part 'misc.g.dart';

/// Which card checkout the clients run (`cardPaymentFlow` in
/// `GET /config/features`).
enum CardPaymentFlow {
  /// A card bound in the profile, charged in one tap (Agroprombank «Клевер»).
  token,

  /// The bank's hosted payment page (Agroprombank «Web-платёж»).
  web,

  /// Card payments are off.
  none;

  /// Null for a value this build does not know, so the caller can fall back.
  static CardPaymentFlow? tryParse(Object? raw) => switch (raw) {
    'token' => CardPaymentFlow.token,
    'web' => CardPaymentFlow.web,
    'none' => CardPaymentFlow.none,
    _ => null,
  };
}

/// Deployment switches from `GET /config/features`. All default to off, the
/// same way the API does, so an unreachable endpoint never exposes a flow
/// the server would refuse. Parsed by hand: [cardPaymentFlow] falls back on
/// another field, which json_serializable cannot express.
class FeatureFlags {
  /// Without an explicit [cardPaymentFlow] (an API that predates it, or a
  /// value this build does not know) the bound-card flow runs whenever
  /// [agroprombankEnabled] is on.
  const FeatureFlags({this.deliveryEnabled = false, this.agroprombankEnabled = false, CardPaymentFlow? cardPaymentFlow})
    : cardPaymentFlow = cardPaymentFlow ?? (agroprombankEnabled ? CardPaymentFlow.token : CardPaymentFlow.none);

  factory FeatureFlags.fromJson(Map<String, dynamic> json) => FeatureFlags(
    deliveryEnabled: json['deliveryEnabled'] as bool? ?? false,
    agroprombankEnabled: json['agroprombankEnabled'] as bool? ?? false,
    cardPaymentFlow: CardPaymentFlow.tryParse(json['cardPaymentFlow']),
  );

  static const off = FeatureFlags();

  final bool deliveryEnabled;

  /// "Bound cards work on this server". Not necessarily the flow in use —
  /// that is [cardPaymentFlow].
  final bool agroprombankEnabled;
  final CardPaymentFlow cardPaymentFlow;

  /// Checkout charges a bound card; the profile manages cards.
  bool get boundCardsEnabled => cardPaymentFlow == CardPaymentFlow.token;

  /// Checkout sends the customer to the bank's payment page.
  bool get webPaymentsEnabled => cardPaymentFlow == CardPaymentFlow.web;

  /// Orders can be paid by card one way or the other.
  bool get cardPaymentsEnabled => cardPaymentFlow != CardPaymentFlow.none;

  Map<String, dynamic> toJson() => {
    'deliveryEnabled': deliveryEnabled,
    'agroprombankEnabled': agroprombankEnabled,
    'cardPaymentFlow': cardPaymentFlow.name,
  };
}

@JsonSerializable(createToJson: false)
class DeliveryQuote {
  const DeliveryQuote({
    required this.feeCents,
    required this.deliverable,
    required this.currency,
    this.distanceM,
    this.reason,
  });

  factory DeliveryQuote.fromJson(Map<String, dynamic> json) => _$DeliveryQuoteFromJson(json);

  final int feeCents;
  final double? distanceM;
  final bool deliverable;

  /// e.g. OUTSIDE_RADIUS, STORE_NOT_DELIVERING.
  final String? reason;
  final String currency;
}

@JsonSerializable(createFactory: false, includeIfNull: false)
class DeviceRegistration {
  const DeviceRegistration({
    required this.type,
    required this.pushToken,
    this.apnsToken,
    this.apnsEnvironment,
    this.locale,
  });

  /// IOS / ANDROID.
  final String type;

  /// The Firebase Cloud Messaging token.
  final String pushToken;

  /// iOS only: the raw APNs device token (hex). The API pushes to it
  /// directly and leaves the FCM token of this device out.
  final String? apnsToken;

  /// iOS only: PRODUCTION (store / TestFlight builds) or SANDBOX (debug
  /// builds) — the APNs gateway [apnsToken] belongs to.
  final String? apnsEnvironment;
  final String? locale;

  Map<String, dynamic> toJson() => _$DeviceRegistrationToJson(this);
}
