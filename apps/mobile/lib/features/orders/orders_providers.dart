import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/network/api_error.dart';
import '../../core/providers.dart';
import '../../core/realtime/realtime_service.dart';

enum OrdersGroup {
  active('ACTIVE'),
  history('HISTORY');

  const OrdersGroup(this.api);
  final String api;
}

/// The customer's orders in one group, refreshed whenever any of them moves.
final ordersProvider = FutureProvider.family<List<OrderSummary>, OrdersGroup>((ref, group) async {
  final userId = ref.watch(currentUserIdProvider);
  if (userId == null) return const [];
  ref.listen(orderEventsProvider, (_, _) => ref.invalidateSelf());
  try {
    return await ref.watch(apiProvider).myOrders(group: group.api, take: 50);
  } on Object catch (error) {
    throw ApiError.from(error);
  }
});

/// Orders still in flight — drives the live-order banner above the tabs.
final activeOrdersProvider = Provider<List<OrderSummary>>((ref) {
  final orders = ref.watch(ordersProvider(OrdersGroup.active)).valueOrNull ?? const [];
  return orders.where((o) => !o.status.isTerminal).toList();
});

/// One order, kept live: socket events patch the status immediately and
/// trigger a full re-read (payment state changes with acceptance); a poll
/// covers the moments the socket is down. Polling stops at a final status.
class OrderController extends AutoDisposeFamilyAsyncNotifier<Order, String> {
  Timer? _poll;

  TakeAwayApi get _api => ref.read(apiProvider);

  @override
  Future<Order> build(String orderId) async {
    final realtime = ref.watch(realtimeServiceProvider);
    final unwatch = realtime.watchOrder(orderId);
    ref.onDispose(() {
      unwatch();
      _poll?.cancel();
    });

    ref.listen(orderEventsProvider, (_, next) {
      final event = next.valueOrNull;
      if (event == null || event.orderId != orderId) return;
      final current = state.valueOrNull;
      if (current != null && event.status != OrderStatus.unknown) {
        state = AsyncData(current.copyWithStatus(event.status));
      }
      unawaited(refresh());
    });

    final order = await _load(orderId);
    _schedulePoll(realtime);
    return order;
  }

  Future<Order> _load(String orderId) async {
    try {
      return await _api.order(orderId);
    } on Object catch (error) {
      throw ApiError.from(error);
    }
  }

  void _schedulePoll(RealtimeService realtime) {
    _poll?.cancel();
    _poll = Timer.periodic(const Duration(seconds: 5), (timer) {
      final order = state.valueOrNull;
      if (order == null || order.status.isTerminal) {
        timer.cancel();
        return;
      }
      // Every 5 s while the socket is down, every 30 s as a safety net.
      final every = realtime.connected.value ? 6 : 1;
      if (timer.tick % every == 0) unawaited(refresh());
    });
  }

  Future<void> refresh() async {
    try {
      final fresh = await _api.order(arg);
      state = AsyncData(fresh);
    } on Object {
      // Keep showing the last good copy; the next tick retries.
    }
  }

  Future<void> cancel() async {
    try {
      state = AsyncData(await _api.cancelOrder(arg));
      ref.invalidate(ordersProvider);
    } on Object catch (error) {
      throw ApiError.from(error);
    }
  }

  /// Geofencing ping; `iAmHere` forces the "customer at the counter" signal.
  Future<CustomerLocationResult?> reportLocation({double? lat, double? lng, bool iAmHere = false}) async {
    try {
      return await _api.reportLocation(arg, {'lat': lat ?? 0, 'lng': lng ?? 0, if (iAmHere) 'iAmHere': true});
    } on Object catch (error) {
      if (iAmHere) throw ApiError.from(error);
      return null;
    }
  }

  Future<void> resendReceipt() async {
    try {
      await _api.resendReceipt(arg);
    } on Object catch (error) {
      throw ApiError.from(error);
    }
  }
}

final orderProvider = AsyncNotifierProvider.autoDispose.family<OrderController, Order, String>(OrderController.new);
