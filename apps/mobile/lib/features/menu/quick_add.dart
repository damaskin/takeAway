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

/// Whether [product] needs its screen before it can go into the cart: what
/// its page starts with is not a valid choice (a size with no default to
/// pick, a required portion that ran out) — the same rule as the menu's
/// `hasRequiredOptions`.
bool needsChoosing(ProductDetail product) => needsOptionChoice(product.optionGroups);

/// The «+» on a product outside its own screen — a menu card, the cart's
/// suggestions. Puts a product whose defaults make a whole choice straight
/// into the cart, with those defaults; one with a size or a portion still to
/// pick opens its screen, so nobody orders a latte without saying which
/// one. A menu product the API marks `hasRequiredOptions` opens at once,
/// without fetching it first. Errors (the cart refusing it) are the
/// caller's to show. [onBusy] runs once the customer is signed in and the
/// product is being fetched — time to show a spinner.
Future<QuickAddResult> quickAdd(
  BuildContext context,
  WidgetRef ref,
  Product product,
  Store store, {
  VoidCallback? onBusy,
}) async {
  // From the live list: the card may have been built before the store closed.
  if (!(ref.read(liveStoreProvider(store.id)) ?? store).takesOrders) return QuickAddResult.skipped;
  if (product.hasRequiredOptions) {
    unawaited(context.push(Routes.product(product.id), extra: product));
    return QuickAddResult.opened;
  }
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
  await ref
      .read(cartProvider(store.id).notifier)
      .add(productId: detail.id, options: toOptionSelections(defaultOptionPicks(detail.optionGroups)));
  unawaited(HapticFeedback.mediumImpact());
  return QuickAddResult.added;
}
