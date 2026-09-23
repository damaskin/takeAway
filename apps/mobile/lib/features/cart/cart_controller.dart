import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/network/api_error.dart';
import '../../core/providers.dart';
import '../catalog/catalog_providers.dart';

/// The customer's cart at one store. The server owns it (it is shared with
/// the web and the Mini App, and it computes the ETA), so every change is a
/// round trip; quantity edits and removals are applied optimistically and
/// rolled back if the server says no.
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

  Future<Cart> add({
    required String productId,
    int quantity = 1,
    List<String> variationIds = const [],
    Map<String, int> modifiers = const {},
    String? notes,
  }) async {
    await _settled();
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
      state = AsyncData(cart);
      final added = cart.items.where((item) => item.productId == productId).lastOrNull;
      if (added != null) ref.read(cartAdditionProvider.notifier).state = CartAddition(added.productName);
      return cart;
    } on Object catch (error) {
      throw ApiError.from(error);
    }
  }

  Future<void> setQuantity(String itemId, int quantity) async {
    if (quantity <= 0) return remove(itemId);
    await _settled();
    final before = state.valueOrNull;
    if (before != null) state = AsyncData(_withQuantity(before, itemId, quantity));
    try {
      state = AsyncData(await _api.updateCartItem(itemId, {'quantity': quantity}));
    } on Object catch (error) {
      if (before != null) state = AsyncData(before);
      throw ApiError.from(error);
    }
  }

  Future<void> remove(String itemId) async {
    await _settled();
    final before = state.valueOrNull;
    if (before != null) state = AsyncData(_without(before, itemId));
    try {
      state = AsyncData(await _api.removeCartItem(itemId));
    } on Object catch (error) {
      if (before != null) state = AsyncData(before);
      throw ApiError.from(error);
    }
  }

  Future<void> clear() async {
    await _settled();
    final before = state.valueOrNull;
    if (before != null) state = AsyncData(_emptied(before));
    try {
      state = AsyncData(await _api.clearCart(arg));
    } on Object catch (error) {
      if (before != null) state = AsyncData(before);
      throw ApiError.from(error);
    }
  }

  /// Re-reads the cart — after an order is placed the server has emptied it.
  Future<void> reload() async {
    if (ref.read(currentUserIdProvider) == null) return;
    await _settled();
    try {
      state = AsyncData(await _api.cart(arg));
    } on Object {
      // Keep what we show; the next change will resync.
    }
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
