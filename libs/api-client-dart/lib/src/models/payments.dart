import 'package:json_annotation/json_annotation.dart';

part 'payments.g.dart';

@JsonSerializable(createToJson: false)
class CardInstitute {
  const CardInstitute({required this.code, required this.name});

  factory CardInstitute.fromJson(Map<String, dynamic> json) => _$CardInstituteFromJson(json);

  final String code;
  final String name;
}

/// A card bound through Agroprombank («Клевер»). The app never sees the
/// full number — only the bank's mask and our opaque id.
@JsonSerializable(createToJson: false)
class BoundCard {
  const BoundCard({
    required this.id,
    required this.isDefault,
    required this.createdAt,
    this.maskedPan,
    this.embossing,
    this.institute,
    this.instituteName,
    this.label,
    this.cardState,
    this.lastUsedAt,
  });

  factory BoundCard.fromJson(Map<String, dynamic> json) => _$BoundCardFromJson(json);

  final String id;
  final String? maskedPan;
  final String? embossing;
  final String? institute;
  final String? instituteName;
  final String? label;
  final bool isDefault;

  /// 1 — active, -1 — blocked at the issuer.
  final int? cardState;
  final DateTime createdAt;
  final DateTime? lastUsedAt;

  bool get isInactive => cardState == -1;

  /// Last four digits pulled out of the bank mask, for compact labels.
  String? get last4 {
    final digits = (maskedPan ?? '').replaceAll(RegExp(r'[^0-9]'), '');
    return digits.length >= 4 ? digits.substring(digits.length - 4) : null;
  }
}

@JsonSerializable(createToJson: false)
class StartBindingResult {
  const StartBindingResult({required this.bindingId, required this.completed, required this.expiresAt, this.card});

  factory StartBindingResult.fromJson(Map<String, dynamic> json) => _$StartBindingResultFromJson(json);

  final String bindingId;
  final bool completed;
  final BoundCard? card;
  final DateTime expiresAt;
}

@JsonSerializable(createToJson: false)
class ChargeResult {
  const ChargeResult({required this.paymentId, required this.status, required this.amountCents});

  factory ChargeResult.fromJson(Map<String, dynamic> json) => _$ChargeResultFromJson(json);

  final String paymentId;
  final String status;
  final int amountCents;
}

@JsonSerializable(createFactory: false, includeIfNull: false)
class BindCardRequest {
  const BindCardRequest({required this.lastDigits, required this.phone, required this.institute, this.label});

  final String lastDigits;
  final String phone;
  final String institute;
  final String? label;

  Map<String, dynamic> toJson() => _$BindCardRequestToJson(this);
}
