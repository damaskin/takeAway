import 'package:json_annotation/json_annotation.dart';

part 'auth.g.dart';

@JsonSerializable()
class AuthUser {
  const AuthUser({
    required this.id,
    required this.locale,
    required this.currency,
    required this.role,
    this.phone,
    this.email,
    this.name,
    this.telegramUserId,
  });

  factory AuthUser.fromJson(Map<String, dynamic> json) => _$AuthUserFromJson(json);

  final String id;
  final String? phone;
  final String? email;
  final String? name;
  final String locale;
  final String currency;
  final String role;
  final String? telegramUserId;

  Map<String, dynamic> toJson() => _$AuthUserToJson(this);

  String get firstName {
    final trimmed = name?.trim() ?? '';
    if (trimmed.isEmpty) return '';
    return trimmed.split(RegExp(r'\s+')).first;
  }

  String get initials {
    final parts = (name ?? '').trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return (email ?? '?').substring(0, 1).toUpperCase();
    final first = parts.first.substring(0, 1);
    final last = parts.length > 1 ? parts.last.substring(0, 1) : '';
    return (first + last).toUpperCase();
  }
}

@JsonSerializable()
class AuthTokens {
  const AuthTokens({
    required this.accessToken,
    required this.refreshToken,
    required this.accessTokenExpiresInSeconds,
    required this.refreshTokenExpiresInSeconds,
  });

  factory AuthTokens.fromJson(Map<String, dynamic> json) => _$AuthTokensFromJson(json);

  final String accessToken;
  final String refreshToken;
  final int accessTokenExpiresInSeconds;
  final int refreshTokenExpiresInSeconds;

  Map<String, dynamic> toJson() => _$AuthTokensToJson(this);
}

@JsonSerializable(createToJson: false)
class AuthSessionResponse {
  const AuthSessionResponse({
    required this.accessToken,
    required this.refreshToken,
    required this.accessTokenExpiresInSeconds,
    required this.refreshTokenExpiresInSeconds,
    required this.user,
  });

  factory AuthSessionResponse.fromJson(Map<String, dynamic> json) => _$AuthSessionResponseFromJson(json);

  final String accessToken;
  final String refreshToken;
  final int accessTokenExpiresInSeconds;
  final int refreshTokenExpiresInSeconds;
  final AuthUser user;

  AuthTokens get tokens => AuthTokens(
    accessToken: accessToken,
    refreshToken: refreshToken,
    accessTokenExpiresInSeconds: accessTokenExpiresInSeconds,
    refreshTokenExpiresInSeconds: refreshTokenExpiresInSeconds,
  );
}

@JsonSerializable()
class NotificationPrefs {
  const NotificationPrefs({required this.notifyOrderUpdates, required this.notifyPromotions});

  factory NotificationPrefs.fromJson(Map<String, dynamic> json) => _$NotificationPrefsFromJson(json);

  final bool notifyOrderUpdates;
  final bool notifyPromotions;

  Map<String, dynamic> toJson() => _$NotificationPrefsToJson(this);
}

/// Public bits of the Telegram bot the API signs sessions for.
@JsonSerializable(createToJson: false)
class TelegramAuthConfig {
  const TelegramAuthConfig({this.botId, this.botUsername, this.clientId});

  factory TelegramAuthConfig.fromJson(Map<String, dynamic> json) => _$TelegramAuthConfigFromJson(json);

  final String? botId;
  final String? botUsername;

  /// Telegram Login (OpenID Connect) client id — the bot's numeric id. Null
  /// when the server has no bot for Telegram Login.
  final String? clientId;

  bool get available => clientId != null && clientId!.isNotEmpty;
}

@JsonSerializable(createFactory: false)
class TelegramIdTokenRequest {
  const TelegramIdTokenRequest(this.idToken);

  final String idToken;

  Map<String, dynamic> toJson() => _$TelegramIdTokenRequestToJson(this);
}

@JsonSerializable(createFactory: false)
class OAuthLoginRequest {
  const OAuthLoginRequest({required this.idToken, this.name});

  final String idToken;
  @JsonKey(includeIfNull: false)
  final String? name;

  Map<String, dynamic> toJson() => _$OAuthLoginRequestToJson(this);
}

@JsonSerializable(createFactory: false)
class RefreshRequest {
  const RefreshRequest(this.refreshToken);

  final String refreshToken;

  Map<String, dynamic> toJson() => _$RefreshRequestToJson(this);
}
