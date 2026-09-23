import 'package:json_annotation/json_annotation.dart';

part 'misc.g.dart';

/// Deployment switches from `GET /config/features`. Both default to off, the
/// same way the API does, so an unreachable endpoint never exposes a flow
/// the server would refuse.
@JsonSerializable()
class FeatureFlags {
  const FeatureFlags({this.deliveryEnabled = false, this.agroprombankEnabled = false});

  factory FeatureFlags.fromJson(Map<String, dynamic> json) => _$FeatureFlagsFromJson(json);

  static const off = FeatureFlags();

  @JsonKey(defaultValue: false)
  final bool deliveryEnabled;
  @JsonKey(defaultValue: false)
  final bool agroprombankEnabled;

  Map<String, dynamic> toJson() => _$FeatureFlagsToJson(this);
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
  const DeviceRegistration({required this.type, required this.pushToken, this.locale});

  /// IOS / ANDROID.
  final String type;
  final String pushToken;
  final String? locale;

  Map<String, dynamic> toJson() => _$DeviceRegistrationToJson(this);
}
