import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/core/auth/session.dart';
import 'package:takeaway_mobile/core/auth/session_manager.dart';
import 'package:takeaway_mobile/core/network/auth_interceptor.dart';

import '../helpers/fake_http.dart';

const user = AuthUser(id: 'u1', locale: 'EN', currency: 'USD', role: 'CUSTOMER', name: 'Ivan');

Session session({
  String access = 'access-1',
  String refresh = 'refresh-1',
  Duration accessLeft = const Duration(minutes: 10),
}) => Session(
  accessToken: access,
  refreshToken: refresh,
  accessExpiresAt: DateTime.now().add(accessLeft),
  refreshExpiresAt: DateTime.now().add(const Duration(days: 7)),
  user: user,
);

AuthTokens tokens(String n) => AuthTokens(
  accessToken: 'access-$n',
  refreshToken: 'refresh-$n',
  accessTokenExpiresInSeconds: 900,
  refreshTokenExpiresInSeconds: 604800,
);

({Dio dio, FakeAdapter adapter, SessionManager sessions}) setUpClient(
  FutureOr<(int, Object?)> Function(RequestOptions) handler, {
  Session? initial,
  Future<AuthTokens> Function(String refreshToken)? refresher,
}) {
  final sessions = SessionManager(storage: MemorySessionStorage(), initial: initial ?? session());
  if (refresher != null) sessions.refresher = refresher;
  final dio = Dio(BaseOptions(baseUrl: 'https://api.test/api'));
  final adapter = FakeAdapter(handler);
  dio
    ..httpClientAdapter = adapter
    ..interceptors.add(AuthInterceptor(sessions: sessions, dio: dio));
  return (dio: dio, adapter: adapter, sessions: sessions);
}

void main() {
  test('attaches the bearer token', () async {
    final c = setUpClient((o) => (200, {'ok': true}));
    await c.dio.get<Object?>('/auth/me');
    expect(c.adapter.seen.single.headers['Authorization'], 'Bearer access-1');
  });

  test('sends public requests without a token', () async {
    final c = setUpClient((o) => (200, <Object>[]));
    await c.dio.get<Object?>('/stores', options: Options(extra: {'public': true}));
    expect(c.adapter.seen.single.headers.containsKey('Authorization'), isFalse);
  });

  test('rotates once on a 401 and replays the request with the new token', () async {
    var refreshes = 0;
    final c = setUpClient(
      (o) => o.headers['Authorization'] == 'Bearer access-2' ? (200, {'id': 'u1'}) : (401, {'message': 'expired'}),
      refresher: (refreshToken) async {
        refreshes++;
        expect(refreshToken, 'refresh-1');
        return tokens('2');
      },
    );

    final response = await c.dio.get<Map<String, dynamic>>('/auth/me');

    expect(response.data, {'id': 'u1'});
    expect(refreshes, 1);
    expect(c.sessions.current!.accessToken, 'access-2');
    expect(c.sessions.current!.refreshToken, 'refresh-2');
  });

  test('parallel 401s share a single rotation — the API rotates refresh tokens', () async {
    var refreshes = 0;
    final gate = Completer<void>();
    final c = setUpClient(
      (o) => o.headers['Authorization'] == 'Bearer access-2' ? (200, {'ok': true}) : (401, null),
      refresher: (_) async {
        refreshes++;
        await gate.future;
        return tokens('2');
      },
    );

    final calls = [for (var i = 0; i < 4; i++) c.dio.get<Object?>('/orders/$i')];
    await Future<void>.delayed(const Duration(milliseconds: 20));
    gate.complete();
    await Future.wait(calls);

    expect(refreshes, 1);
  });

  test('ends the session when the refresh token is refused', () async {
    final ended = <SessionEndReason>[];
    final c = setUpClient(
      (o) => (401, {'message': 'nope'}),
      refresher: (_) async => throw DioException(
        requestOptions: RequestOptions(path: '/auth/refresh'),
        response: Response<Object?>(requestOptions: RequestOptions(path: '/auth/refresh'), statusCode: 401),
        type: DioExceptionType.badResponse,
      ),
    );
    c.sessions.ended.listen(ended.add);

    await expectLater(c.dio.get<Object?>('/cart'), throwsA(isA<DioException>()));
    await Future<void>.delayed(Duration.zero);

    expect(c.sessions.current, isNull);
    expect(ended, [SessionEndReason.expired]);
  });

  test('keeps the session when the refresh fails for network reasons', () async {
    final c = setUpClient(
      (o) => (401, null),
      refresher: (_) async => throw DioException(
        requestOptions: RequestOptions(path: '/auth/refresh'),
        type: DioExceptionType.connectionError,
      ),
    );

    await expectLater(c.dio.get<Object?>('/cart'), throwsA(isA<DioException>()));
    expect(c.sessions.current, isNotNull);
  });

  test('refreshes proactively when the access token is about to lapse', () async {
    var refreshes = 0;
    final c = setUpClient(
      (o) => (200, {'ok': true}),
      initial: session(accessLeft: const Duration(seconds: 10)),
      refresher: (_) async {
        refreshes++;
        return tokens('2');
      },
    );

    await c.dio.get<Object?>('/me/orders');

    expect(refreshes, 1);
    expect(c.adapter.seen.single.headers['Authorization'], 'Bearer access-2');
  });

  test('does not retry forever when the replay is also rejected', () async {
    var refreshes = 0;
    final c = setUpClient(
      (o) => (401, null),
      refresher: (_) async {
        refreshes++;
        return tokens('$refreshes');
      },
    );

    await expectLater(c.dio.get<Object?>('/cart'), throwsA(isA<DioException>()));
    expect(refreshes, 1);
    expect(c.adapter.seen, hasLength(2));
  });

  group('Session', () {
    test('survives a round trip through storage', () {
      final original = session();
      final restored = Session.tryDecode(original.encode())!;
      expect(restored.accessToken, original.accessToken);
      expect(restored.user.name, 'Ivan');
      expect(restored.accessExpiresAt, original.accessExpiresAt);
    });

    test('rejects garbage instead of throwing', () {
      expect(Session.tryDecode('{not json'), isNull);
      expect(Session.tryDecode(null), isNull);
    });

    test('restore drops a session whose refresh token has expired', () async {
      final storage = MemorySessionStorage(
        Session(
          accessToken: 'a',
          refreshToken: 'r',
          accessExpiresAt: DateTime.now().subtract(const Duration(days: 8)),
          refreshExpiresAt: DateTime.now().subtract(const Duration(days: 1)),
          user: user,
        ).encode(),
      );
      expect(await SessionManager.restore(storage), isNull);
      expect(await storage.read(), isNull);
    });
  });
}
