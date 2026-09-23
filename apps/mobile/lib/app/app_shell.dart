import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../core/auth/session_manager.dart';
import '../core/providers.dart';
import '../core/push/push_service.dart';
import '../core/theme/tokens.dart';
import '../features/cart/cart_controller.dart';
import '../features/catalog/catalog_providers.dart';
import '../features/orders/orders_providers.dart';
import '../l10n/app_localizations.dart';
import '../shared/widgets/state_views.dart';
import 'router.dart';

/// Bottom-tab frame around the four main sections. Also the one place that
/// reacts to app-wide events: notification taps, foreground pushes, an
/// expired session, and coming back to the foreground.
class AppShell extends ConsumerStatefulWidget {
  const AppShell({required this.shell, super.key});

  final StatefulNavigationShell shell;

  @override
  ConsumerState<AppShell> createState() => _AppShellState();
}

class _AppShellState extends ConsumerState<AppShell> {
  final _subscriptions = <StreamSubscription<Object?>>[];
  late final AppLifecycleListener _lifecycle;

  @override
  void initState() {
    super.initState();
    final push = ref.read(pushServiceProvider);
    _subscriptions
      ..add(push.opened.listen(_openFromPush))
      ..add(push.foreground.listen(_showForegroundPush))
      ..add(ref.read(sessionManagerProvider).ended.listen(_onSessionEnded));
    _lifecycle = AppLifecycleListener(onResume: _onResume);
  }

  @override
  void dispose() {
    for (final sub in _subscriptions) {
      unawaited(sub.cancel());
    }
    _lifecycle.dispose();
    super.dispose();
  }

  void _openFromPush(PushMessage message) {
    final orderId = message.orderId;
    if (orderId != null && ref.read(isSignedInProvider)) GoRouter.of(context).push(Routes.order(orderId));
  }

  void _showForegroundPush(PushMessage message) {
    // A push about an order that is already on screen would be noise.
    final location = GoRouter.of(context).routerDelegate.currentConfiguration.uri.path;
    if (message.orderId != null && location == '/order/${message.orderId}') return;
    final text = [message.title, message.body].whereType<String>().join(' · ');
    if (text.isEmpty) return;
    Snack.show(
      context,
      text,
      icon: Icons.notifications_active_outlined,
      actionLabel: message.orderId == null ? null : AppLocalizations.of(context).viewCart,
      onAction: message.orderId == null ? null : () => _openFromPush(message),
    );
  }

  void _onSessionEnded(SessionEndReason reason) {
    if (reason == SessionEndReason.expired && mounted) {
      Snack.show(context, AppLocalizations.of(context).sessionExpired, icon: Icons.lock_clock_outlined);
    }
  }

  void _onResume() {
    // Orders move while the app sleeps; menus and ETAs drift.
    ref
      ..invalidate(ordersProvider)
      ..invalidate(storesProvider);
    final storeId = ref.read(activeStoreProvider)?.id;
    if (storeId != null) unawaited(ref.read(cartProvider(storeId).notifier).reload());
  }

  void _onTab(int index) {
    HapticFeedback.selectionClick();
    widget.shell.goBranch(index, initialLocation: index == widget.shell.currentIndex);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final activeOrders = ref.watch(activeOrdersProvider).length;

    return Scaffold(
      body: widget.shell,
      bottomNavigationBar: DecoratedBox(
        decoration: BoxDecoration(
          border: Border(top: BorderSide(color: brand.borderLight)),
        ),
        child: NavigationBar(
          selectedIndex: widget.shell.currentIndex,
          onDestinationSelected: _onTab,
          labelBehavior: NavigationDestinationLabelBehavior.alwaysShow,
          destinations: [
            NavigationDestination(
              icon: const Icon(Icons.local_cafe_outlined),
              selectedIcon: const Icon(Icons.local_cafe_rounded),
              label: l10n.navMenu,
            ),
            NavigationDestination(
              icon: const Icon(Icons.storefront_outlined),
              selectedIcon: const Icon(Icons.storefront_rounded),
              label: l10n.navStores,
            ),
            NavigationDestination(
              icon: Badge.count(
                count: activeOrders,
                isLabelVisible: activeOrders > 0,
                backgroundColor: brand.caramel,
                child: const Icon(Icons.receipt_long_outlined),
              ),
              selectedIcon: Badge.count(
                count: activeOrders,
                isLabelVisible: activeOrders > 0,
                backgroundColor: brand.caramel,
                child: const Icon(Icons.receipt_long_rounded),
              ),
              label: l10n.navOrders,
            ),
            NavigationDestination(
              icon: const Icon(Icons.person_outline_rounded),
              selectedIcon: const Icon(Icons.person_rounded),
              label: l10n.navProfile,
            ),
          ],
        ),
      ),
    );
  }
}
