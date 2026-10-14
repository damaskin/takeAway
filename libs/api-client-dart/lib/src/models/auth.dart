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

/// `GET /auth/methods`: which customer sign-in methods the server can
/// complete. An API without the route counts as offering none of these.
@JsonSerializable(createToJson: false)
class AuthMethods {
  const AuthMethods({this.email = false, this.google = false, this.apple = false, this.telegram = false});

  factory AuthMethods.fromJson(Map<String, dynamic> json) => _$AuthMethodsFromJson(json);

  static const none = AuthMethods();

  /// Sign-in with a code mailed to the customer; off until the server has SMTP.
  final bool email;
  final bool google;
  final bool apple;
  final bool telegram;
}

/// Body of `POST /auth/email/start`: mail a sign-in code to [email], in the
/// language of [locale].
@JsonSerializable(createFactory: false)
class EmailSignInStartRequest {
  const EmailSignInStartRequest({required this.email, required this.locale});

  final String email;
  final String locale;

  Map<String, dynamic> toJson() => _$EmailSignInStartRequestToJson(this);
}

/// Body of `POST /auth/email/verify`: the six digits from the letter.
@JsonSerializable(createFactory: false)
class EmailSignInVerifyRequest {
  const EmailSignInVerifyRequest({required this.email, required this.code});

  final String email;
  final String code;

  Map<String, dynamic> toJson() => _$EmailSignInVerifyRequestToJson(this);
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

/// Body of `DELETE /auth/me`. When Sign in with Apple leads into the
/// profile, a fresh authorization code lets the API revoke the tokens Apple
/// issued for it.
@JsonSerializable(createFactory: false)
class DeleteAccountRequest {
  const DeleteAccountRequest({this.appleAuthorizationCode});

  @JsonKey(includeIfNull: false)
  final String? appleAuthorizationCode;

  Map<String, dynamic> toJson() => _$DeleteAccountRequestToJson(this);
}

/// Which of Telegram, Google, Apple and email lead into the signed-in profile.
@JsonSerializable(createToJson: false)
class SignInMethods {
  const SignInMethods({required this.telegram, required this.google, required this.apple, this.email});

  factory SignInMethods.fromJson(Map<String, dynamic> json) => _$SignInMethodsFromJson(json);

  final bool telegram;
  final bool google;
  final bool apple;

  /// The proven address a sign-in code goes to; null when there is none
  /// (an address only typed into the profile does not count).
  final String? email;

  int get count => [telegram, google, apple, email != null].where((linked) => linked).length;
}

/// Result of linking a sign-in method. [session] is set when the customer
/// was moved into the profile that method already belonged to (the one with
/// the order history): the app must switch to it.
@JsonSerializable(createToJson: false)
class LinkSignInMethodResult {
  const LinkSignInMethodResult({required this.methods, this.session});

  factory LinkSignInMethodResult.fromJson(Map<String, dynamic> json) => _$LinkSignInMethodResultFromJson(json);

  final SignInMethods methods;
  final AuthSessionResponse? session;
}
