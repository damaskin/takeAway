import 'dart:async';

import 'package:dio/dio.dart';
import 'package:flutter/foundation.dart';
import 'package:flutter_secure_storage/flutter_secure_storage.dart';
import 'package:takeaway_api/takeaway_api.dart';

import 'session.dart';

/// Where the session blob lives between launches.
abstract interface class SessionStorage {
  Future<String?> read();
  Future<void> write(String value);
  Future<void> delete();
}

class SecureSessionStorage implements SessionStorage {
  SecureSessionStorage([FlutterSecureStorage? storage]) : _storage = storage ?? const FlutterSecureStorage();

  static const _key = 'takeaway.session.v1';
  final FlutterSecureStorage _storage;

  @override
  Future<String?> read() => _storage.read(key: _key);

  @override
  Future<void> write(String value) => _storage.write(key: _key, value: value);

  @override
  Future<void> delete() => _storage.delete(key: _key);
}

class MemorySessionStorage implements SessionStorage {
  MemorySessionStorage([this._value]);

  String? _value;

  @override
  Future<String?> read() async => _value;

  @override
  Future<void> write(String value) async => _value = value;

  @override
  Future<void> delete() async => _value = null;
}

typedef TokenRefresher = Future<AuthTokens> Function(String refreshToken);

/// Why a session ended — the UI only apologises for the involuntary kind.
enum SessionEndReason { signedOut, expired }

/// Owns the current [Session]: persistence, rotation and expiry.
///
/// The HTTP layer reads [current] synchronously on every request and calls
/// [refresh] on a 401; the UI listens for changes. Refresh is single-flight
/// because the API rotates refresh tokens — two parallel refreshes would
/// burn the token and log the customer out.
class SessionManager extends ChangeNotifier {
  SessionManager({required SessionStorage storage, Session? initial}) : _storage = storage, _current = initial;

  final SessionStorage _storage;
  Session? _current;
  Future<Session?>? _inFlight;
  TokenRefresher? _refresher;
  final _ended = StreamController<SessionEndReason>.broadcast();

  static Future<Session?> restore(SessionStorage storage) async {
    try {
      final session = Session.tryDecode(await storage.read());
      if (session == null || session.refreshExpired()) {
        await storage.delete();
        return null;
      }
      return session;
    } on Object {
      // Keystore corruption after a backup restore is a known Android
      // failure mode; starting signed out beats crashing on launch.
      return null;
    }
  }

  Session? get current => _current;
  bool get isSignedIn => _current != null;

  /// Emits when the session ends, with the reason.
  Stream<SessionEndReason> get ended => _ended.stream;

  set refresher(TokenRefresher value) => _refresher = value;

  Future<void> start(Session session) => _replace(session);

  Future<void> updateUser(AuthUser user) async {
    final session = _current;
    if (session == null) return;
    await _replace(session.withUser(user));
  }

  /// Rotates the token pair. Concurrent callers share one network call.
  /// Returns null when the session can no longer be renewed (and ends it).
  Future<Session?> refresh() {
    final pending = _inFlight;
    if (pending != null) return pending;
    final future = _doRefresh();
    _inFlight = future;
    return future.whenComplete(() => _inFlight = null);
  }

  Future<Session?> _doRefresh() async {
    final session = _current;
    final refresher = _refresher;
    if (session == null || refresher == null) return null;
    if (session.refreshExpired()) {
      await end(SessionEndReason.expired);
      return null;
    }
    try {
      final tokens = await refresher(session.refreshToken);
      // The user may have signed out while the call was in flight.
      if (_current?.refreshToken != session.refreshToken) return _current;
      final next = session.withTokens(tokens);
      await _replace(next);
      return next;
    } on DioException catch (error) {
      final status = error.response?.statusCode;
      if (status == 401 || status == 403 || status == 400) {
        await end(SessionEndReason.expired);
        return null;
      }
      // Offline or a 5xx: keep the session, the caller surfaces the error.
      rethrow;
    }
  }

  Future<void> end(SessionEndReason reason) async {
    if (_current == null) return;
    _current = null;
    notifyListeners();
    _ended.add(reason);
    await _storage.delete();
  }

  Future<void> _replace(Session session) async {
    _current = session;
    notifyListeners();
    await _storage.write(session.encode());
  }

  @override
  void dispose() {
    unawaited(_ended.close());
    super.dispose();
  }
}
