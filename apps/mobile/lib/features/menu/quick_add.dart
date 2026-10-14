import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../app/router.dart';
import '../auth/sign_in_sheet.dart';
import '../cart/cart_controller.dart';
import '../catalog/catalog_providers.dart';

enum QuickAddResult {
  /// In the cart.
  added,

  /// It has something to choose, so its screen opened instead.
  opened,

  /// Nothing happened: the store stopped taking orders, or the customer did
  /// not sign in.
  skipped,
}

/// Whether [product] needs its screen before it can go into the cart: a size
/// or milk to pick, or an add-on that has to be taken (so its price is seen).
bool needsChoosing(ProductDetail product) =>
    product.variations.isNotEmpty || product.modifiers.any((m) => m.minCount > 0);

/// The «+» on a product outside its own screen — a menu card, the cart's
/// suggestions. Puts a product with nothing to choose straight into the cart;
/// one with sizes, milks or required add-ons opens its screen, so nobody
/// orders a latte without saying which one. Errors (the cart refusing it)
/// are the caller's to show. [onBusy] runs once the customer is signed in
/// and the product is being fetched — time to show a spinner.
Future<QuickAddResult> quickAdd(
  BuildContext context,
  WidgetRef ref,
  Product product,
  Store store, {
  VoidCallback? onBusy,
}) async {
  // From the live list: the card may have been built before the store closed.
  if (!(ref.read(liveStoreProvider(store.id)) ?? store).takesOrders) return QuickAddResult.skipped;
  if (!await ensureSignedIn(context, ref)) return QuickAddResult.skipped;
  if (!context.mounted) return QuickAddResult.skipped;
  onBusy?.call();
  // Fetched afresh: a required add-in may have run out since the product was
  // last opened, and the cart would refuse it.
  final detail = await ref.refresh(storeProductProvider((productId: product.id, storeId: store.id)).future);
  if (!context.mounted) return QuickAddResult.skipped;
  if (needsChoosing(detail)) {
    unawaited(context.push(Routes.product(product.id), extra: product));
    return QuickAddResult.opened;
  }
  await ref.read(cartProvider(store.id).notifier).add(productId: detail.id);
  unawaited(HapticFeedback.mediumImpact());
  return QuickAddResult.added;
}
