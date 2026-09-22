// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'auth.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

AuthUser _$AuthUserFromJson(Map<String, dynamic> json) => AuthUser(
  id: json['id'] as String,
  locale: json['locale'] as String,
  currency: json['currency'] as String,
  role: json['role'] as String,
  phone: json['phone'] as String?,
  email: json['email'] as String?,
  name: json['name'] as String?,
  telegramUserId: json['telegramUserId'] as String?,
);

Map<String, dynamic> _$AuthUserToJson(AuthUser instance) => <String, dynamic>{
  'id': instance.id,
  'phone': instance.phone,
  'email': instance.email,
  'name': instance.name,
  'locale': instance.locale,
  'currency': instance.currency,
  'role': instance.role,
  'telegramUserId': instance.telegramUserId,
};

AuthTokens _$AuthTokensFromJson(Map<String, dynamic> json) => AuthTokens(
  accessToken: json['accessToken'] as String,
  refreshToken: json['refreshToken'] as String,
  accessTokenExpiresInSeconds: (json['accessTokenExpiresInSeconds'] as num).toInt(),
  refreshTokenExpiresInSeconds: (json['refreshTokenExpiresInSeconds'] as num).toInt(),
);

Map<String, dynamic> _$AuthTokensToJson(AuthTokens instance) => <String, dynamic>{
  'accessToken': instance.accessToken,
  'refreshToken': instance.refreshToken,
  'accessTokenExpiresInSeconds': instance.accessTokenExpiresInSeconds,
  'refreshTokenExpiresInSeconds': instance.refreshTokenExpiresInSeconds,
};

AuthSessionResponse _$AuthSessionResponseFromJson(Map<String, dynamic> json) => AuthSessionResponse(
  accessToken: json['accessToken'] as String,
  refreshToken: json['refreshToken'] as String,
  accessTokenExpiresInSeconds: (json['accessTokenExpiresInSeconds'] as num).toInt(),
  refreshTokenExpiresInSeconds: (json['refreshTokenExpiresInSeconds'] as num).toInt(),
  user: AuthUser.fromJson(json['user'] as Map<String, dynamic>),
);

NotificationPrefs _$NotificationPrefsFromJson(Map<String, dynamic> json) => NotificationPrefs(
  notifyOrderUpdates: json['notifyOrderUpdates'] as bool,
  notifyPromotions: json['notifyPromotions'] as bool,
);

Map<String, dynamic> _$NotificationPrefsToJson(NotificationPrefs instance) => <String, dynamic>{
  'notifyOrderUpdates': instance.notifyOrderUpdates,
  'notifyPromotions': instance.notifyPromotions,
};

TelegramAuthConfig _$TelegramAuthConfigFromJson(Map<String, dynamic> json) => TelegramAuthConfig(
  botId: json['botId'] as String?,
  botUsername: json['botUsername'] as String?,
  clientId: json['clientId'] as String?,
);

Map<String, dynamic> _$TelegramIdTokenRequestToJson(TelegramIdTokenRequest instance) => <String, dynamic>{
  'idToken': instance.idToken,
};

Map<String, dynamic> _$OAuthLoginRequestToJson(OAuthLoginRequest instance) => <String, dynamic>{
  'idToken': instance.idToken,
  'name': ?instance.name,
};

Map<String, dynamic> _$RefreshRequestToJson(RefreshRequest instance) => <String, dynamic>{
  'refreshToken': instance.refreshToken,
};
