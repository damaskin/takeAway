import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../app/router.dart';
import '../../core/format/time.dart';
import '../../core/providers.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/money_text.dart';
import '../../shared/widgets/chips.dart';
import '../../shared/widgets/pressable.dart';
import '../cart/cart_controller.dart';
import '../orders/orders_providers.dart';
import '../stores/store_widgets.dart';

/// Greeting plus the store selector — where the order will be picked up and
/// how soon it can be ready, one tap away from changing.
class MenuHeader extends ConsumerWidget {
  const MenuHeader({required this.store, required this.onSearch, super.key});

  final Store store;
  final VoidCallback onSearch;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final name = ref.watch(currentUserProvider)?.firstName ?? '';
    final hour = DateTime.now().hour;
    final greeting = hour < 12
        ? l10n.greetingMorning
        : hour < 18
        ? l10n.greetingAfternoon
        : l10n.greetingEvening;
    final address = displayAddress(store);

    return Padding(
      padding: const EdgeInsets.fromLTRB(20, 12, 12, 8),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text(
                  name.isEmpty ? greeting : l10n.greetingWithName(greeting, name),
                  style: context.text.headlineLarge,
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                ),
              ),
              IconButton.filledTonal(
                onPressed: onSearch,
                tooltip: l10n.menuSearchHint,
                style: IconButton.styleFrom(backgroundColor: brand.foam),
                icon: const Icon(Icons.search_rounded),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Pressable(
            onTap: () => showStorePicker(context),
            child: Container(
              padding: const EdgeInsets.fromLTRB(14, 12, 12, 12),
              decoration: BoxDecoration(
                color: brand.foam,
                borderRadius: BorderRadius.circular(Radii.card),
                border: Border.all(color: brand.borderLight),
                boxShadow: brand.softShadow,
              ),
              child: Row(
                children: [
                  Container(
                    width: 40,
                    height: 40,
                    decoration: BoxDecoration(color: brand.caramelSoft, borderRadius: BorderRadius.circular(12)),
                    child: Icon(Icons.storefront_rounded, color: brand.caramel, size: 22),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(l10n.pickupPoint, style: context.text.labelSmall?.copyWith(color: brand.textTertiary)),
                        const SizedBox(height: 2),
                        Text(store.name, style: context.text.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                        if (address != null)
                          Text(address, style: context.text.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                      ],
                    ),
                  ),
                  const SizedBox(width: 8),
                  // An ETA for a store that is not taking ASAP orders would
                  // be a promise nobody can keep.
                  if (store.isOpen)
                    EtaChip(etaSeconds: store.currentEtaSeconds, busyMeter: store.busyMeter)
                  else
                    StoreStatusBadge(status: store.effectiveStatus),
                  Icon(Icons.expand_more_rounded, color: brand.textTertiary),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}

/// Closed / busy / offline notice under the header.
class StoreNotice extends StatelessWidget {
  const StoreNotice({required this.store, required this.offline, super.key});

  final Store store;
  final bool offline;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final (String? text, Color color, IconData icon) = offline
        ? (l10n.offlineMenu, brand.textSecondary, Icons.cloud_off_rounded)
        : store.effectiveStatus == StoreStatus.closed
        ? (l10n.storeClosedBanner, brand.berry, Icons.nightlight_round)
        : store.effectiveStatus == StoreStatus.overloaded
        ? (l10n.storeBusyBanner, brand.amber, Icons.local_fire_department_rounded)
        : (null, brand.textSecondary, Icons.info_outline);

    return AnimatedSize(
      duration: Motion.medium,
      child: text == null
          ? const SizedBox(width: double.infinity)
          : Padding(
              padding: const EdgeInsets.fromLTRB(16, 4, 16, 4),
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
                decoration: BoxDecoration(
                  color: color.withValues(alpha: 0.12),
                  borderRadius: BorderRadius.circular(Radii.button),
                ),
                child: Row(
                  children: [
                    Icon(icon, size: 18, color: color),
                    const SizedBox(width: 10),
                    Expanded(
                      child: Text(text, style: context.text.bodySmall?.copyWith(color: brand.textPrimary)),
                    ),
                  ],
                ),
              ),
            ),
    );
  }
}

/// The customer's order in flight, one tap from the menu.
class ActiveOrderCard extends ConsumerWidget {
  const ActiveOrderCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final active = ref.watch(activeOrdersProvider);
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final order = active.isEmpty ? null : active.first;

    return AnimatedSwitcher(
      duration: Motion.medium,
      transitionBuilder: (child, animation) => SizeTransition(
        sizeFactor: animation,
        child: FadeTransition(opacity: animation, child: child),
      ),
      child: order == null
          ? const SizedBox(width: double.infinity)
          : Padding(
              key: ValueKey(order.id),
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 4),
              child: Pressable(
                onTap: () => context.push(Routes.order(order.id)),
                child: Container(
                  padding: const EdgeInsets.all(14),
                  decoration: BoxDecoration(
                    gradient: LinearGradient(
                      colors: [brand.espresso, Color.lerp(brand.espresso, brand.caramel, 0.35)!],
                    ),
                    borderRadius: BorderRadius.circular(Radii.card),
                  ),
                  child: Row(
                    children: [
                      _Pulse(color: orderStatusColor(context, order.status)),
                      const SizedBox(width: 12),
                      Expanded(
                        child: Column(
                          crossAxisAlignment: CrossAxisAlignment.start,
                          children: [
                            Text(
                              l10n.liveOrder.toUpperCase(),
                              style: context.text.labelSmall?.copyWith(
                                color: brand.cream.withValues(alpha: 0.7),
                                letterSpacing: 1.1,
                              ),
                            ),
                            const SizedBox(height: 2),
                            Text(
                              l10n.activeOrderBanner(order.orderCode, orderStatusLabel(context, order.status)),
                              style: context.text.titleSmall?.copyWith(color: brand.cream),
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                            Text(
                              l10n.pickupAt(formatClock(context, order.pickupAt)),
                              style: context.text.bodySmall?.copyWith(color: brand.cream.withValues(alpha: 0.75)),
                            ),
                          ],
                        ),
                      ),
                      if (active.length > 1)
                        Padding(
                          padding: const EdgeInsets.only(right: 6),
                          child: Text(
                            '+${active.length - 1}',
                            style: context.text.labelMedium?.copyWith(color: brand.cream),
                          ),
                        ),
                      Icon(Icons.chevron_right_rounded, color: brand.cream),
                    ],
                  ),
                ),
              ),
            ),
    );
  }
}

class _Pulse extends StatefulWidget {
  const _Pulse({required this.color});

  final Color color;

  @override
  State<_Pulse> createState() => _PulseState();
}

class _PulseState extends State<_Pulse> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1600),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: 28,
      height: 28,
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) => Stack(
          alignment: Alignment.center,
          children: [
            Container(
              width: 12 + 16 * _controller.value,
              height: 12 + 16 * _controller.value,
              decoration: BoxDecoration(
                shape: BoxShape.circle,
                color: widget.color.withValues(alpha: 0.45 * (1 - _controller.value)),
              ),
            ),
            Container(
              width: 12,
              height: 12,
              decoration: BoxDecoration(shape: BoxShape.circle, color: widget.color),
            ),
          ],
        ),
      ),
    );
  }
}

/// Pinned horizontal category chips with scroll-spy highlighting.
class CategoryBarDelegate extends SliverPersistentHeaderDelegate {
  CategoryBarDelegate({
    required this.categories,
    required this.selected,
    required this.onSelect,
    required this.chipKeys,
    required this.background,
    required this.divider,
  });

  static const height = 56.0;

  final List<MenuCategory> categories;
  final int selected;
  final ValueChanged<int> onSelect;
  final List<GlobalKey> chipKeys;
  final Color background;
  final Color divider;

  @override
  double get minExtent => height;

  @override
  double get maxExtent => height;

  @override
  Widget build(BuildContext context, double shrinkOffset, bool overlapsContent) {
    final brand = context.brand;
    return AnimatedContainer(
      duration: Motion.fast,
      decoration: BoxDecoration(
        color: background,
        border: Border(bottom: BorderSide(color: overlapsContent ? divider : Colors.transparent)),
      ),
      child: ListView.separated(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 10),
        itemCount: categories.length,
        separatorBuilder: (_, _) => const SizedBox(width: 8),
        itemBuilder: (context, index) {
          final active = index == selected;
          return Pressable(
            key: chipKeys[index],
            onTap: () => onSelect(index),
            child: AnimatedContainer(
              duration: Motion.medium,
              curve: Motion.emphasized,
              padding: const EdgeInsets.symmetric(horizontal: 16),
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: active ? brand.espresso : brand.foam,
                borderRadius: BorderRadius.circular(Radii.pill),
                border: Border.all(color: active ? brand.espresso : brand.borderLight),
              ),
              child: Text(
                categories[index].name,
                style: context.text.labelMedium?.copyWith(
                  color: active ? brand.cream : brand.textPrimary,
                  fontWeight: active ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            ),
          );
        },
      ),
    );
  }

  @override
  bool shouldRebuild(CategoryBarDelegate old) =>
      old.selected != selected || old.categories != categories || old.background != background;
}

/// Bottom bar summarising the cart; bumps when something is added.
class CartBar extends ConsumerStatefulWidget {
  const CartBar({required this.currency, super.key});

  final String currency;

  @override
  ConsumerState<CartBar> createState() => _CartBarState();
}

class _CartBarState extends ConsumerState<CartBar> with SingleTickerProviderStateMixin {
  late final AnimationController _bump = AnimationController(vsync: this, duration: const Duration(milliseconds: 420));
  int _lastCount = 0;

  /// What was just added, shown in place of the summary for a moment.
  String? _added;
  Timer? _addedTimer;

  @override
  void dispose() {
    _addedTimer?.cancel();
    _bump.dispose();
    super.dispose();
  }

  void _acknowledge(CartAddition? addition) {
    if (addition == null) return;
    _addedTimer?.cancel();
    setState(() => _added = addition.productName);
    _addedTimer = Timer(const Duration(milliseconds: 2200), () {
      if (mounted) setState(() => _added = null);
    });
  }

  @override
  Widget build(BuildContext context) {
    ref.listen(cartAdditionProvider, (_, addition) => _acknowledge(addition));
    final cart = ref.watch(activeCartProvider).valueOrNull;
    final count = cart?.itemCount ?? 0;
    if (count > _lastCount && _lastCount > 0) _bump.forward(from: 0);
    _lastCount = count;

    final visible = cart != null && count > 0;
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final readyAt = DateTime.now().add(Duration(seconds: cart?.etaSeconds ?? 0));
    final labelStyle = context.text.labelLarge?.copyWith(color: Colors.white);
    final added = _added;

    return AnimatedSlide(
      offset: visible ? Offset.zero : const Offset(0, 1.6),
      duration: Motion.slow,
      curve: Motion.emphasized,
      child: AnimatedOpacity(
        opacity: visible ? 1 : 0,
        duration: Motion.medium,
        child: AnimatedBuilder(
          animation: _bump,
          builder: (context, child) {
            final t = Curves.easeOut.transform(_bump.value);
            final scale = 1 + 0.04 * (t < 0.5 ? t * 2 : (1 - t) * 2);
            return Transform.scale(scale: scale, child: child);
          },
          child: Pressable(
            onTap: visible ? () => context.push(Routes.cart) : null,
            scale: 0.98,
            child: Container(
              height: 60,
              padding: const EdgeInsets.symmetric(horizontal: 18),
              decoration: BoxDecoration(
                color: brand.caramel,
                borderRadius: BorderRadius.circular(Radii.card),
                boxShadow: [
                  BoxShadow(color: brand.caramel.withValues(alpha: 0.35), blurRadius: 24, offset: const Offset(0, 10)),
                ],
              ),
              child: Row(
                children: [
                  Container(
                    width: 30,
                    height: 30,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: Colors.white.withValues(alpha: 0.22), shape: BoxShape.circle),
                    child: Text(
                      '$count',
                      style: context.text.labelLarge?.copyWith(color: Colors.white, fontWeight: FontWeight.w700),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: AnimatedSwitcher(
                      duration: Motion.medium,
                      switchInCurve: Motion.emphasized,
                      switchOutCurve: Curves.easeIn,
                      layoutBuilder: (current, previous) =>
                          Stack(alignment: Alignment.centerLeft, children: [...previous, ?current]),
                      transitionBuilder: (child, animation) => FadeTransition(
                        opacity: animation,
                        child: SlideTransition(
                          position: Tween(begin: const Offset(0, 0.6), end: Offset.zero).animate(animation),
                          child: child,
                        ),
                      ),
                      child: added != null
                          ? Row(
                              key: ValueKey('added-$added'),
                              children: [
                                const Icon(Icons.check_circle_rounded, color: Colors.white, size: 18),
                                const SizedBox(width: 6),
                                Flexible(
                                  child: Text(
                                    l10n.addedToCart(added),
                                    style: labelStyle,
                                    maxLines: 1,
                                    overflow: TextOverflow.ellipsis,
                                  ),
                                ),
                              ],
                            )
                          : Text(
                              l10n.cartBarLabel(count, formatClock(context, readyAt)),
                              key: const ValueKey('summary'),
                              style: labelStyle,
                              maxLines: 1,
                              overflow: TextOverflow.ellipsis,
                            ),
                    ),
                  ),
                  AnimatedMoney(
                    cents: cart?.subtotalCents ?? 0,
                    currency: widget.currency,
                    style: context.text.titleMedium!.copyWith(color: Colors.white, fontWeight: FontWeight.w700),
                  ),
                  const SizedBox(width: 4),
                  const Icon(Icons.chevron_right_rounded, color: Colors.white),
                ],
              ),
            ),
          ),
        ),
      ),
    );
  }
}
