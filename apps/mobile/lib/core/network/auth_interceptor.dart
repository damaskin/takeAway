import 'package:dio/dio.dart';

import '../auth/session_manager.dart';

/// Attaches the bearer token and keeps it fresh.
///
/// - Before a request: if the access token is about to lapse, rotate first.
/// - On a 401: rotate once and replay the request; if rotation is refused
///   the session ends and the 401 propagates.
///
/// Deliberately a plain [Interceptor], not a queued one: the replay goes
/// back through this same client, and a queued error handler would wait on
/// itself if the replay failed too. Concurrency is handled one level down —
/// [SessionManager.refresh] is single-flight.
///
/// Requests marked with `extra['public'] = true` are sent without a token.
class AuthInterceptor extends Interceptor {
  AuthInterceptor({required this.sessions, required this.dio});

  final SessionManager sessions;

  /// The same client, used to replay a request after a rotation.
  final Dio dio;

  static const _retriedKey = 'auth.retried';

  @override
  Future<void> onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    if (options.extra['public'] == true) return handler.next(options);
    var session = sessions.current;
    if (session != null && session.accessExpiresSoon()) {
      try {
        session = await sessions.refresh();
      } on DioException {
        // Offline: send the (possibly stale) token and let the server decide.
      }
    }
    if (session != null) options.headers['Authorization'] = 'Bearer ${session.accessToken}';
    handler.next(options);
  }

  @override
  Future<void> onError(DioException err, ErrorInterceptorHandler handler) async {
    final request = err.requestOptions;
    final unauthorized = err.response?.statusCode == 401;
    if (!unauthorized || request.extra[_retriedKey] == true || request.extra['public'] == true) {
      return handler.next(err);
    }
    final session = sessions.current;
    if (session == null) return handler.next(err);

    try {
      // Another request may already have rotated the pair while this one
      // was in flight; only refresh when we still hold the token that failed.
      final sentWith = request.headers['Authorization'];
      final fresh = sentWith == 'Bearer ${session.accessToken}' ? await sessions.refresh() : session;
      if (fresh == null) return handler.next(err);

      request.extra[_retriedKey] = true;
      request.headers['Authorization'] = 'Bearer ${fresh.accessToken}';
      final response = await dio.fetch<dynamic>(request);
      handler.resolve(response);
    } on DioException catch (retryError) {
      handler.next(retryError);
    }
  }
}
