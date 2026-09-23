import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../app/router.dart';
import '../../core/format/time.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/money_text.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/chips.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import '../catalog/catalog_providers.dart';
import '../stores/store_widgets.dart';
import 'cart_controller.dart';
import 'cart_line.dart';

class CartScreen extends ConsumerWidget {
  const CartScreen({super.key});

  Future<void> _remove(BuildContext context, WidgetRef ref, String storeId, CartItem item) async {
    final controller = ref.read(cartProvider(storeId).notifier);
    final l10n = AppLocalizations.of(context);
    try {
      await controller.remove(item.id);
      if (!context.mounted) return;
      Snack.show(
        context,
        l10n.cartItemRemoved(item.productName),
        icon: Icons.delete_outline_rounded,
        actionLabel: l10n.undo,
        onAction: () => controller.add(
          productId: item.productId,
          quantity: item.quantity,
          variationIds: item.variationIds,
          modifiers: item.modifiers,
          notes: item.notes,
        ),
      );
    } on Object catch (error) {
      if (context.mounted) Snack.error(context, error);
    }
  }

  Future<void> _clear(BuildContext context, WidgetRef ref, String storeId) async {
    final l10n = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.cartClearConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l10n.cancel)),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: context.brand.berry),
            child: Text(l10n.cartClear),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(cartProvider(storeId).notifier).clear();
    } on Object catch (error) {
      if (context.mounted) Snack.error(context, error);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final store = ref.watch(activeStoreProvider);
    final cartAsync = ref.watch(activeCartProvider);
    final cart = cartAsync.valueOrNull;

    return Scaffold(
      appBar: AppBar(
        title: Text(l10n.cartTitle),
        actions: [
          if (store != null && cart != null && !cart.isEmpty)
            IconButton(
              tooltip: l10n.cartClear,
              icon: const Icon(Icons.delete_sweep_outlined),
              onPressed: () => _clear(context, ref, store.id),
            ),
        ],
      ),
      body: store == null
          ? EmptyState(icon: Icons.storefront_outlined, title: l10n.chooseStoreTitle)
          : cartAsync.when(
              loading: () => ShimmerScope(
                child: ListView(
                  padding: const EdgeInsets.all(16),
                  children: [
                    for (var i = 0; i < 3; i++) ...[
                      const Skeleton(height: 96, radius: Radii.card),
                      const SizedBox(height: 12),
                    ],
                  ],
                ),
              ),
              error: (error, _) => ErrorState(error: error, onRetry: () => ref.invalidate(cartProvider(store.id))),
              data: (cart) => cart == null || cart.isEmpty
                  ? EmptyState(
                      icon: Icons.shopping_bag_outlined,
                      title: l10n.cartEmptyTitle,
                      message: l10n.cartEmptyBody,
                      actionLabel: l10n.browseMenu,
                      onAction: () => context.go(Routes.menu),
                    )
                  : RefreshIndicator(
                      color: brand.caramel,
                      onRefresh: () => ref.read(cartProvider(store.id).notifier).reload(),
                      child: ListView(
                        padding: const EdgeInsets.fromLTRB(16, 8, 16, 24),
                        children: [
                          _StoreSummary(store: store, cart: cart),
                          const SizedBox(height: 16),
                          for (final item in cart.items)
                            Padding(
                              key: ValueKey(item.id),
                              padding: const EdgeInsets.only(bottom: 12),
                              child: Dismissible(
                                key: ValueKey('dismiss-${item.id}'),
                                direction: DismissDirection.endToStart,
                                background: Container(
                                  alignment: Alignment.centerRight,
                                  padding: const EdgeInsets.only(right: 24),
                                  decoration: BoxDecoration(
                                    color: brand.berry.withValues(alpha: 0.15),
                                    borderRadius: BorderRadius.circular(Radii.card),
                                  ),
                                  child: Icon(Icons.delete_outline_rounded, color: brand.berry),
                                ),
                                onDismissed: (_) {
                                  HapticFeedback.mediumImpact();
                                  _remove(context, ref, store.id, item);
                                },
                                child: CartLine(
                                  item: item,
                                  storeId: store.id,
                                  currency: store.currency,
                                  onQuantity: (q) async {
                                    if (q == 0) return _remove(context, ref, store.id, item);
                                    try {
                                      await ref.read(cartProvider(store.id).notifier).setQuantity(item.id, q);
                                    } on Object catch (error) {
                                      if (context.mounted) Snack.error(context, error);
                                    }
                                  },
                                ),
                              ),
                            ),
                          const SizedBox(height: 4),
                          Row(
                            children: [
                              Text(l10n.subtotal, style: context.text.titleMedium),
                              const Spacer(),
                              AnimatedMoney(
                                cents: cart.subtotalCents,
                                currency: store.currency,
                                style: context.text.titleLarge!,
                              ),
                            ],
                          ),
                        ],
                      ),
                    ),
            ),
      bottomNavigationBar: store == null || cart == null || cart.isEmpty
          ? null
          : SafeArea(
              minimum: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: PrimaryButton(
                label: l10n.cartCheckout(context.money(cart.subtotalCents, store.currency)),
                icon: Icons.arrow_forward_rounded,
                onPressed: () => context.push(Routes.checkout),
              ),
            ),
    );
  }
}

class _StoreSummary extends StatelessWidget {
  const _StoreSummary({required this.store, required this.cart});

  final Store store;
  final Cart cart;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final l10n = AppLocalizations.of(context);
    final address = displayAddress(store);
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(color: brand.caramelSoft, borderRadius: BorderRadius.circular(Radii.card)),
      child: Row(
        children: [
          Icon(Icons.storefront_rounded, color: brand.caramel),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(store.name, style: context.text.titleSmall),
                Text(address ?? l10n.readyInMinutes(minutesCeil(cart.etaSeconds)), style: context.text.bodySmall),
              ],
            ),
          ),
          if (store.isOpen)
            EtaChip(etaSeconds: cart.etaSeconds, busyMeter: store.busyMeter)
          else
            StoreStatusBadge(status: store.effectiveStatus),
        ],
      ),
    );
  }
}
