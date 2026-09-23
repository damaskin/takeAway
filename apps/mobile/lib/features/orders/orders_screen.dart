import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../app/router.dart';
import '../../core/format/time.dart';
import '../../core/providers.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/money_text.dart';
import '../../shared/widgets/chips.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import '../auth/sign_in_sheet.dart';
import 'orders_providers.dart';

class OrdersScreen extends ConsumerWidget {
  const OrdersScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final signedIn = ref.watch(isSignedInProvider);

    if (!signedIn) {
      return Scaffold(
        appBar: AppBar(title: Text(l10n.ordersTitle)),
        body: EmptyState(
          icon: Icons.receipt_long_outlined,
          title: l10n.ordersSignIn,
          message: l10n.profileGuestBody,
          actionLabel: l10n.signIn,
          onAction: () => ensureSignedIn(context, ref),
        ),
      );
    }

    return DefaultTabController(
      length: 2,
      child: Scaffold(
        appBar: AppBar(
          title: Text(l10n.ordersTitle),
          bottom: TabBar(
            indicatorColor: context.brand.caramel,
            labelColor: context.brand.textPrimary,
            unselectedLabelColor: context.brand.textTertiary,
            labelStyle: context.text.titleSmall,
            dividerColor: context.brand.borderLight,
            tabs: [
              Tab(text: l10n.ordersActive),
              Tab(text: l10n.ordersHistory),
            ],
          ),
        ),
        body: const TabBarView(
          children: [
            _OrdersList(group: OrdersGroup.active),
            _OrdersList(group: OrdersGroup.history),
          ],
        ),
      ),
    );
  }
}

class _OrdersList extends ConsumerWidget {
  const _OrdersList({required this.group});

  final OrdersGroup group;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final async = ref.watch(ordersProvider(group));

    Future<void> refresh() => ref.refresh(ordersProvider(group).future);

    return RefreshIndicator(
      color: context.brand.caramel,
      onRefresh: refresh,
      child: async.when(
        loading: () => ShimmerScope(
          child: ListView(
            padding: const EdgeInsets.all(16),
            children: [
              for (var i = 0; i < 4; i++) ...[
                const Skeleton(height: 92, radius: Radii.card),
                const SizedBox(height: 12),
              ],
            ],
          ),
        ),
        error: (error, _) => ListView(
          children: [ErrorState(error: error, onRetry: () => ref.invalidate(ordersProvider(group)))],
        ),
        data: (orders) => orders.isEmpty
            ? ListView(
                children: [
                  EmptyState(
                    icon: group == OrdersGroup.active ? Icons.local_cafe_outlined : Icons.history_rounded,
                    title: group == OrdersGroup.active ? l10n.ordersEmptyActive : l10n.ordersEmptyHistory,
                    message: l10n.ordersEmptyBody,
                    actionLabel: l10n.browseMenu,
                    onAction: () => context.go(Routes.menu),
                  ),
                ],
              )
            : ListView.separated(
                padding: const EdgeInsets.fromLTRB(16, 16, 16, 24),
                itemCount: orders.length,
                separatorBuilder: (_, _) => const SizedBox(height: 12),
                itemBuilder: (context, index) => TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0, end: 1),
                  duration: Duration(milliseconds: 260 + 40 * index.clamp(0, 8)),
                  curve: Curves.easeOutCubic,
                  builder: (context, t, child) => Opacity(
                    opacity: t,
                    child: Transform.translate(offset: Offset(0, 16 * (1 - t)), child: child),
                  ),
                  child: _OrderCard(order: orders[index]),
                ),
              ),
      ),
    );
  }
}

class _OrderCard extends StatelessWidget {
  const _OrderCard({required this.order});

  final OrderSummary order;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final locale = Localizations.localeOf(context).toLanguageTag();
    final created = order.createdAt.toLocal();
    final today = isSameDay(created, DateTime.now());
    final date = today
        ? formatClock(context, created)
        : '${DateFormat.MMMd(locale).format(created)}, ${formatClock(context, created)}';

    return Pressable(
      onTap: () => context.push(Routes.order(order.id)),
      child: Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: brand.foam,
          borderRadius: BorderRadius.circular(Radii.card),
          border: Border.all(color: brand.borderLight),
        ),
        child: Row(
          children: [
            Container(
              width: 52,
              height: 52,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                color: orderStatusColor(context, order.status).withValues(alpha: 0.14),
                borderRadius: BorderRadius.circular(14),
              ),
              child: Text(
                order.orderCode,
                style: context.text.titleSmall?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
              ),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(order.storeName, style: context.text.titleSmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: 2),
                  Text('$date · ${l10n.itemsCount(order.itemCount)}', style: context.text.bodySmall),
                  const SizedBox(height: 8),
                  OrderStatusBadge(status: order.status),
                ],
              ),
            ),
            Column(
              crossAxisAlignment: CrossAxisAlignment.end,
              children: [
                Text(context.money(order.totalCents, order.currency), style: context.text.titleSmall),
                const SizedBox(height: 18),
                Icon(Icons.chevron_right_rounded, color: brand.textTertiary),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
