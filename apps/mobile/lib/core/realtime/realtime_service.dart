import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:socket_io_client/socket_io_client.dart' as io;
import 'package:takeaway_api/takeaway_api.dart';

import '../auth/session_manager.dart';
import '../config/env.dart';
import '../providers.dart';

/// A store started or ended taking orders (staff opened or closed the
/// shift, or switched it off). Broadcast to every connected socket.
class StoreAvailabilityEvent {
  const StoreAvailabilityEvent({required this.storeId, this.brandId, this.acceptingOrders});

  /// Null when the payload is not one: no store id.
  static StoreAvailabilityEvent? tryParse(Object? data) {
    if (data is! Map) return null;
    final storeId = data['storeId'];
    if (storeId is! String || storeId.isEmpty) return null;
    final brandId = data['brandId'];
    final accepting = data['acceptingOrders'];
    return StoreAvailabilityEvent(
      storeId: storeId,
      brandId: brandId is String ? brandId : null,
      acceptingOrders: accepting is bool ? accepting : null,
    );
  }

  final String storeId;
  final String? brandId;
  final bool? acceptingOrders;
}

/// Live order updates over the API's Socket.IO gateway (`/ws` namespace).
///
/// The server puts every signed-in socket into its user's room, so status
/// changes for all of the customer's orders arrive without subscribing;
/// subscribing to a specific order additionally covers the order room. The
/// token is supplied through an auth callback, so each reconnect presents a
/// fresh one — the gateway checks it only at connect time.
///
/// Signed out, the socket connects anonymously (no token): the gateway
/// accepts that for storefronts, which still receive the public
/// `store.availabilityChanged` broadcast.
class RealtimeService {
  RealtimeService(this._sessions);

  final SessionManager _sessions;
  io.Socket? _socket;
  final _events = StreamController<OrderStatusEvent>.broadcast();
  final _storeEvents = StreamController<StoreAvailabilityEvent>.broadcast();
  final _orderRooms = <String>{};
  final connected = ValueNotifier<bool>(false);
  bool _disposed = false;

  Stream<OrderStatusEvent> get events => _events.stream;

  /// Stores opening and closing, as staff start and end shifts.
  Stream<StoreAvailabilityEvent> get storeEvents => _storeEvents.stream;

  /// Feeds a raw `store.availabilityChanged` payload in; malformed ones are
  /// dropped. Public so tests can play the server.
  void handleStoreAvailability(Object? data) {
    final event = StoreAvailabilityEvent.tryParse(data);
    if (event != null && !_storeEvents.isClosed) _storeEvents.add(event);
  }

  void connect() {
    if (_disposed || _socket != null) return;

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
      if (reason == 'io server disconnect' && !_disposed) {
        Future<void>.delayed(const Duration(seconds: 2), () {
          if (!_disposed && identical(_socket, socket)) socket.connect();
        });
      }
    });
    socket
      ..on('order.statusChanged', (data) {
        if (data is Map) _events.add(OrderStatusEvent.fromJson(Map<String, dynamic>.from(data)));
      })
      ..on('store.availabilityChanged', handleStoreAvailability);

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
    // No session: no token at all, which the gateway takes as anonymous.
    final token = session?.accessToken;
    callback(token == null || token.isEmpty ? <String, dynamic>{} : {'token': token});
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
    unawaited(_storeEvents.close());
    connected.dispose();
  }
}

/// One socket per identity: rebuilt on sign-in and sign-out, so the
/// connection always carries the current account — or none (anonymous).
final realtimeServiceProvider = Provider<RealtimeService>((ref) {
  ref.watch(currentUserIdProvider);
  final service = RealtimeService(ref.watch(sessionManagerProvider))..connect();
  ref.onDispose(service.dispose);
  return service;
});

/// Every `order.statusChanged` event for the signed-in customer.
final orderEventsProvider = StreamProvider<OrderStatusEvent>((ref) => ref.watch(realtimeServiceProvider).events);

/// Every `store.availabilityChanged` event, signed in or not.
final storeAvailabilityEventsProvider = StreamProvider<StoreAvailabilityEvent>(
  (ref) => ref.watch(realtimeServiceProvider).storeEvents,
);
