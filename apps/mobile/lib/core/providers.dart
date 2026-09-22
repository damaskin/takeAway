import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:takeaway_api/takeaway_api.dart';

import 'auth/session.dart';
import 'auth/session_manager.dart';
import 'config/env.dart';
import 'network/auth_interceptor.dart';
import 'storage/json_cache.dart';

/// Overridden in `main()` once the instance is loaded.
final sharedPreferencesProvider = Provider<SharedPreferences>((ref) => throw UnimplementedError());

/// Overridden in `main()` with the session restored from secure storage.
final sessionManagerProvider = Provider<SessionManager>((ref) => throw UnimplementedError());

/// Overridden in `main()`; a disk cache for catalog data so the menu opens
/// instantly and still works offline.
final jsonCacheProvider = Provider<JsonCache>((ref) => throw UnimplementedError());

BaseOptions _baseOptions() => BaseOptions(
  baseUrl: Env.apiBaseUrl,
  connectTimeout: const Duration(seconds: 10),
  sendTimeout: const Duration(seconds: 15),
  receiveTimeout: const Duration(seconds: 20),
  headers: const {'Accept': 'application/json'},
);

/// Authenticated client used by every feature.
final dioProvider = Provider<Dio>((ref) {
  final sessions = ref.watch(sessionManagerProvider);
  final dio = Dio(_baseOptions());

  // Token rotation goes through a bare client: it must not carry the
  // expired access token, nor recurse into the interceptor that called it.
  final bare = Dio(_baseOptions());
  sessions.refresher = (refreshToken) async {
    final response = await bare.post<Map<String, dynamic>>('/auth/refresh', data: {'refreshToken': refreshToken});
    return AuthTokens.fromJson(response.data!);
  };

  dio.interceptors.add(AuthInterceptor(sessions: sessions, dio: dio));
  if (kDebugMode) {
    dio.interceptors.add(LogInterceptor(logPrint: (o) => debugPrint('$o')));
  }
  ref.onDispose(() {
    dio.close();
    bare.close();
  });
  return dio;
});

final apiProvider = Provider<TakeAwayApi>((ref) => TakeAwayApi(ref.watch(dioProvider)));

/// The signed-in session, or null. Rebuilds dependants whenever the session
/// starts, rotates its user, or ends.
final sessionProvider = Provider<Session?>((ref) {
  final manager = ref.watch(sessionManagerProvider);
  void onChange() => ref.invalidateSelf();
  manager.addListener(onChange);
  ref.onDispose(() => manager.removeListener(onChange));
  return manager.current;
});

/// Identity of the signed-in user. Data that belongs to a user (cart,
/// orders, points) watches this, so signing out or switching accounts
/// drops it automatically — but a token rotation does not.
final currentUserIdProvider = Provider<String?>((ref) => ref.watch(sessionProvider.select((s) => s?.user.id)));

final currentUserProvider = Provider<AuthUser?>((ref) => ref.watch(sessionProvider)?.user);

final isSignedInProvider = Provider<bool>((ref) => ref.watch(currentUserIdProvider) != null);
