import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/network/api_error.dart';
import '../../core/providers.dart';
import '../catalog/catalog_providers.dart';

/// The customer's cart at one store. The server owns it (it is shared with
/// the web and the Mini App, and it computes the ETA), so every change is a
/// round trip; quantity edits and removals are applied optimistically, sent
/// one after another, and resynced from the server if it says no.
class CartController extends FamilyAsyncNotifier<Cart?, String> {
  TakeAwayApi get _api => ref.read(apiProvider);

  @override
  Future<Cart?> build(String storeId) async {
    final userId = ref.watch(currentUserIdProvider);
    if (userId == null) return null;
    try {
      return await ref.watch(apiProvider).cart(storeId);
    } on Object catch (error) {
      throw ApiError.from(error);
    }
  }

  /// Lets a read of the cart that is already in flight land first — signing
  /// in starts one, and the customer's first add usually follows at once.
  /// Finishing after the change, that read would put the older cart back.
  Future<void> _settled() async {
    try {
      await future;
    } on Object {
      // A failed read is superseded by whatever the change returns.
    }
  }

  /// Changes go to the server one at a time, in the order they were made.
  ///
  /// Tapping + three times sends three requests. Sent side by side they can
  /// land in any order, and each answer used to replace the cart as it
  /// arrived: the count jumped 2 → 3 → 2, and a tap made while it showed the
  /// stale 2 asked for 3 again, so an increment was lost. Now each request
  /// waits for the one before it, and an answer is only shown when nothing
  /// newer is queued behind it — until then the optimistic count stands.
  Future<void> _tail = Future<void>.value();
  int _queued = 0;

  Future<T> _enqueue<T>(Future<T> Function() change) {
    _queued++;
    final run = _tail.then((_) async {
      await _settled();
      try {
        return await change();
      } finally {
        _queued--;
      }
    });
    _tail = run.then((_) {}, onError: (_) {});
    return run;
  }

  /// Applies the server's cart, unless a newer change is still on its way —
  /// its own answer will be the one to show.
  void _accept(Cart cart) {
    if (_queued <= 1) state = AsyncData(cart);
  }

  /// After a refused change the optimistic cart is wrong, and so may be the
  /// snapshot taken before it, if other changes went through meanwhile. Only
  /// the server knows, so ask it.
  Future<void> _resync(Cart? fallback) async {
    try {
      state = AsyncData(await _api.cart(arg));
    } on Object {
      if (fallback != null) state = AsyncData(fallback);
    }
  }

  Future<Cart> add({
    required String productId,
    int quantity = 1,
    List<String> variationIds = const [],
    Map<String, int> modifiers = const {},
    String? notes,
  }) {
    return _enqueue(() async {
      try {
        final cart = await _api.addCartItem(
          AddCartItemRequest(
            storeId: arg,
            productId: productId,
            quantity: quantity,
            variationIds: variationIds,
            modifiers: {
              for (final entry in modifiers.entries)
                if (entry.value > 0) entry.key: entry.value,
            },
            notes: notes == null || notes.trim().isEmpty ? null : notes.trim(),
          ),
        );
        _accept(cart);
        final added = cart.items.where((item) => item.productId == productId).lastOrNull;
        if (added != null) ref.read(cartAdditionProvider.notifier).state = CartAddition(added.productName);
        return cart;
      } on Object catch (error) {
        throw ApiError.from(error);
      }
    });
  }

  Future<void> setQuantity(String itemId, int quantity) {
    if (quantity <= 0) return remove(itemId);
    return _optimistic(
      (cart) => _withQuantity(cart, itemId, quantity),
      () => _api.updateCartItem(itemId, {'quantity': quantity}),
    );
  }

  Future<void> remove(String itemId) =>
      _optimistic((cart) => _without(cart, itemId), () => _api.removeCartItem(itemId));

  Future<void> clear() => _optimistic(_emptied, () => _api.clearCart(arg));

  /// Shows the change at once, then queues it for the server.
  Future<void> _optimistic(Cart Function(Cart) apply, Future<Cart> Function() request) {
    final before = state.isLoading ? null : state.valueOrNull;
    if (before != null) state = AsyncData(apply(before));
    return _enqueue(() async {
      try {
        _accept(await request());
      } on Object catch (error) {
        await _resync(before);
        throw ApiError.from(error);
      }
    });
  }

  /// Re-reads the cart — after an order is placed the server has emptied it.
  Future<void> reload() async {
    if (ref.read(currentUserIdProvider) == null) return;
    await _enqueue(() async {
      try {
        _accept(await _api.cart(arg));
      } on Object {
        // Keep what we show; the next change will resync.
      }
    });
  }

  static Cart _withQuantity(Cart cart, String itemId, int quantity) {
    final items = [
      for (final item in cart.items)
        item.id == itemId
            ? CartItem(
                id: item.id,
                productId: item.productId,
                productName: item.productName,
                quantity: quantity,
                variationIds: item.variationIds,
                modifiers: item.modifiers,
                unitPriceCents: item.unitPriceCents,
                unitPrepSeconds: item.unitPrepSeconds,
                notes: item.notes,
              )
            : item,
    ];
    return _rebuild(cart, items);
  }

  static Cart _without(Cart cart, String itemId) => _rebuild(cart, cart.items.where((i) => i.id != itemId).toList());

  static Cart _emptied(Cart cart) => _rebuild(cart, const []);

  static Cart _rebuild(Cart cart, List<CartItem> items) => Cart(
    id: cart.id,
    userId: cart.userId,
    storeId: cart.storeId,
    subtotalCents: items.fold(0, (sum, i) => sum + i.lineTotalCents),
    etaSeconds: cart.etaSeconds,
    items: items,
    updatedAt: cart.updatedAt,
  );
}

/// Something just went into the cart. The cart bar acknowledges it in place
/// of a snackbar, which would cover the very bar the customer taps next.
/// A new instance per add, so adding the same latte twice still registers.
class CartAddition {
  CartAddition(this.productName);

  final String productName;
}

final cartAdditionProvider = StateProvider<CartAddition?>((ref) => null);

final cartProvider = AsyncNotifierProvider.family<CartController, Cart?, String>(CartController.new);

/// Cart for the store the customer is currently ordering from.
final activeCartProvider = Provider<AsyncValue<Cart?>>((ref) {
  final storeId = ref.watch(activeStoreProvider.select((s) => s?.id));
  if (storeId == null) return const AsyncData(null);
  return ref.watch(cartProvider(storeId));
});
