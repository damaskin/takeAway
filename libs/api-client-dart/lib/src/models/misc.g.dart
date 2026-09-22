// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'misc.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

FeatureFlags _$FeatureFlagsFromJson(Map<String, dynamic> json) => FeatureFlags(
  deliveryEnabled: json['deliveryEnabled'] as bool? ?? false,
  agroprombankEnabled: json['agroprombankEnabled'] as bool? ?? false,
);

Map<String, dynamic> _$FeatureFlagsToJson(FeatureFlags instance) => <String, dynamic>{
  'deliveryEnabled': instance.deliveryEnabled,
  'agroprombankEnabled': instance.agroprombankEnabled,
};

DeliveryQuote _$DeliveryQuoteFromJson(Map<String, dynamic> json) => DeliveryQuote(
  feeCents: (json['feeCents'] as num).toInt(),
  deliverable: json['deliverable'] as bool,
  currency: json['currency'] as String,
  distanceM: (json['distanceM'] as num?)?.toDouble(),
  reason: json['reason'] as String?,
);

Map<String, dynamic> _$DeviceRegistrationToJson(DeviceRegistration instance) => <String, dynamic>{
  'type': instance.type,
  'pushToken': instance.pushToken,
  'locale': ?instance.locale,
};
