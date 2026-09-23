import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:takeaway_api/takeaway_api.dart';

import '../auth/session_manager.dart';
import '../config/env.dart';
import '../providers.dart';

/// Live order updates over the API's Socket.IO gateway (`/ws` namespace).
///
/// The server puts every socket into its user's room, so status changes for
/// all of the customer's orders arrive without subscribing; subscribing to a
/// specific order additionally covers the order room. The token is supplied
/// through an auth callback, so each reconnect presents a fresh one — the
/// gateway checks it only at connect time.
class RealtimeService {
  RealtimeService(this._sessions);

  final SessionManager _sessions;
  io.Socket? _socket;
  final _events = StreamController<OrderStatusEvent>.broadcast();
  final _orderRooms = <String>{};
  final connected = ValueNotifier<bool>(false);
  bool _disposed = false;

  Stream<OrderStatusEvent> get events => _events.stream;

  void connect() {
    if (_disposed || _socket != null || _sessions.current == null) return;

    final socket = io.io(
      '${Env.realtimeUrl}/ws',
      io.OptionBuilder()
          .setTransports(['websocket'])
          .enableForceNew()
          .disableAutoConnect()
          .enableReconnection()
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(15000)
          .setAuthFn((callback) => unawaited(_withFreshToken(callback)))
          .build(),
    );

    socket.onConnect((_) {
      connected.value = true;
      for (final orderId in _orderRooms) {
        socket.emit('order.subscribe', {'orderId': orderId});
      }
    });
    socket.onDisconnect((reason) {
      connected.value = false;
      // A server-side kick (expired token, deploy) is not retried by the
      // client library on its own.
      if (reason == 'io server disconnect' && !_disposed && _sessions.current != null) {
        Future<void>.delayed(const Duration(seconds: 2), () {
          if (!_disposed && identical(_socket, socket)) socket.connect();
        });
      }
    });
    socket.on('order.statusChanged', (data) {
      if (data is Map) _events.add(OrderStatusEvent.fromJson(Map<String, dynamic>.from(data)));
    });

    _socket = socket;
    socket.connect();
  }

  Future<void> _withFreshToken(void Function(Map<dynamic, dynamic>) callback) async {
    var session = _sessions.current;
    if (session != null && session.accessExpiresSoon()) {
      try {
        session = await _sessions.refresh();
      } on Object {
        // Offline — present what we have; the gateway will say no.
      }
    }
    callback({'token': session?.accessToken ?? ''});
  }

  /// Joins an order's room for as long as the returned callback is not called.
  VoidCallback watchOrder(String orderId) {
    _orderRooms.add(orderId);
    connect();
    final socket = _socket;
    if (socket != null && socket.connected) socket.emit('order.subscribe', {'orderId': orderId});
    return () {
      _orderRooms.remove(orderId);
      final current = _socket;
      if (current != null && current.connected) current.emit('order.unsubscribe', {'orderId': orderId});
    };
  }

  void disconnect() {
    final socket = _socket;
    _socket = null;
    connected.value = false;
    socket?.dispose();
  }

  void dispose() {
    _disposed = true;
    disconnect();
    unawaited(_events.close());
    connected.dispose();
  }
}

/// One socket per signed-in user; torn down on sign-out.
final realtimeServiceProvider = Provider<RealtimeService>((ref) {
  final userId = ref.watch(currentUserIdProvider);
  final service = RealtimeService(ref.watch(sessionManagerProvider));
  if (userId != null) service.connect();
  ref.onDispose(service.dispose);
  return service;
});

/// Every `order.statusChanged` event for the signed-in customer.
final orderEventsProvider = StreamProvider<OrderStatusEvent>((ref) => ref.watch(realtimeServiceProvider).events);
