import 'dart:convert';

import 'package:takeaway_api/takeaway_api.dart';

/// A signed-in session: the token pair, when each half expires, and the
/// user it belongs to. Persisted as one JSON blob in secure storage.
class Session {
  const Session({
    required this.accessToken,
    required this.refreshToken,
    required this.accessExpiresAt,
    required this.refreshExpiresAt,
    required this.user,
  });

  factory Session.fromTokens(AuthTokens tokens, AuthUser user, {DateTime? now}) {
    final issued = now ?? DateTime.now();
    return Session(
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      accessExpiresAt: issued.add(Duration(seconds: tokens.accessTokenExpiresInSeconds)),
      refreshExpiresAt: issued.add(Duration(seconds: tokens.refreshTokenExpiresInSeconds)),
      user: user,
    );
  }

  factory Session.fromJson(Map<String, dynamic> json) => Session(
    accessToken: json['accessToken'] as String,
    refreshToken: json['refreshToken'] as String,
    accessExpiresAt: DateTime.parse(json['accessExpiresAt'] as String),
    refreshExpiresAt: DateTime.parse(json['refreshExpiresAt'] as String),
    user: AuthUser.fromJson(json['user'] as Map<String, dynamic>),
  );

  static Session? tryDecode(String? raw) {
    if (raw == null || raw.isEmpty) return null;
    try {
      return Session.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } on Object {
      return null;
    }
  }

  final String accessToken;
  final String refreshToken;
  final DateTime accessExpiresAt;
  final DateTime refreshExpiresAt;
  final AuthUser user;

  /// Refresh a little before the access token actually lapses, so a request
  /// never races its own expiry on a slow network.
  bool accessExpiresSoon({DateTime? now}) =>
      (now ?? DateTime.now()).isAfter(accessExpiresAt.subtract(const Duration(seconds: 45)));

  bool refreshExpired({DateTime? now}) => (now ?? DateTime.now()).isAfter(refreshExpiresAt);

  Session withTokens(AuthTokens tokens, {DateTime? now}) => Session.fromTokens(tokens, user, now: now);

  Session withUser(AuthUser next) => Session(
    accessToken: accessToken,
    refreshToken: refreshToken,
    accessExpiresAt: accessExpiresAt,
    refreshExpiresAt: refreshExpiresAt,
    user: next,
  );

  Map<String, dynamic> toJson() => {
    'accessToken': accessToken,
    'refreshToken': refreshToken,
    'accessExpiresAt': accessExpiresAt.toIso8601String(),
    'refreshExpiresAt': refreshExpiresAt.toIso8601String(),
    'user': user.toJson(),
  };

  String encode() => jsonEncode(toJson());
}
