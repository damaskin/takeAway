// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'payments.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

CardInstitute _$CardInstituteFromJson(Map<String, dynamic> json) =>
    CardInstitute(code: json['code'] as String, name: json['name'] as String);

BoundCard _$BoundCardFromJson(Map<String, dynamic> json) => BoundCard(
  id: json['id'] as String,
  isDefault: json['isDefault'] as bool,
  createdAt: DateTime.parse(json['createdAt'] as String),
  maskedPan: json['maskedPan'] as String?,
  embossing: json['embossing'] as String?,
  institute: json['institute'] as String?,
  instituteName: json['instituteName'] as String?,
  label: json['label'] as String?,
  cardState: (json['cardState'] as num?)?.toInt(),
  lastUsedAt: json['lastUsedAt'] == null ? null : DateTime.parse(json['lastUsedAt'] as String),
);

StartBindingResult _$StartBindingResultFromJson(Map<String, dynamic> json) => StartBindingResult(
  bindingId: json['bindingId'] as String,
  completed: json['completed'] as bool,
  expiresAt: DateTime.parse(json['expiresAt'] as String),
  card: json['card'] == null ? null : BoundCard.fromJson(json['card'] as Map<String, dynamic>),
);

ChargeResult _$ChargeResultFromJson(Map<String, dynamic> json) => ChargeResult(
  paymentId: json['paymentId'] as String,
  status: json['status'] as String,
  amountCents: (json['amountCents'] as num).toInt(),
);

Map<String, dynamic> _$BindCardRequestToJson(BindCardRequest instance) => <String, dynamic>{
  'lastDigits': instance.lastDigits,
  'phone': instance.phone,
  'institute': instance.institute,
  'label': ?instance.label,
};
