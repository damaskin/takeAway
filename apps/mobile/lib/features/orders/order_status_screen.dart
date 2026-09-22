import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:qr_flutter/qr_flutter.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../app/router.dart';
import '../../core/format/time.dart';
import '../../core/location/location_service.dart';
import '../../core/providers.dart';
import '../../core/push/push_service.dart';
import '../../core/realtime/realtime_service.dart';
import '../../core/storage/app_prefs.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/directions.dart';
import '../../shared/money_text.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/chips.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/store_map.dart';
import '../cart/cart_controller.dart';
import '../catalog/catalog_providers.dart';
import 'order_progress.dart';
import 'orders_providers.dart';

class OrderStatusScreen extends ConsumerStatefulWidget {
  const OrderStatusScreen({required this.orderId, this.justPlaced = false, super.key});

  final String orderId;

  /// Arrived straight from checkout: celebrate, and offer notifications.
  final bool justPlaced;

  @override
  ConsumerState<OrderStatusScreen> createState() => _OrderStatusScreenState();
}

class _OrderStatusScreenState extends ConsumerState<OrderStatusScreen> {
  Timer? _ticker;
  Timer? _geofence;
  DateTime _now = DateTime.now();
  bool _hereSent = false;
  bool _hereBusy = false;
  bool _reordering = false;
  LatLng? _userPosition;
  OrderStatus? _lastStatus;

  @override
  void initState() {
    super.initState();
    _ticker = Timer.periodic(const Duration(seconds: 1), (_) {
      if (mounted) setState(() => _now = DateTime.now());
    });
    unawaited(_startGeofence());
    if (widget.justPlaced) {
      WidgetsBinding.instance.addPostFrameCallback((_) => unawaited(_offerNotifications()));
    }
  }

  @override
  void dispose() {
    _ticker?.cancel();
    _geofence?.cancel();
    super.dispose();
  }

  /// Coarse location pings while the order is on its way, so the barista
  /// sees "customer nearby" without the customer doing anything. Only with
  /// a permission already granted — this screen never prompts on its own.
  Future<void> _startGeofence() async {
    final location = ref.read(locationServiceProvider);
    if (!await location.hasPermission()) return;
    Future<void> ping() async {
      final order = ref.read(orderProvider(widget.orderId)).valueOrNull;
      if (order == null || order.status.isTerminal || order.isDelivery) {
        _geofence?.cancel();
        return;
      }
      final result = await location.locate(prompt: false, timeout: const Duration(seconds: 6));
      if (!mounted || !result.ok) return;
      setState(() => _userPosition = result.position);
      await ref
          .read(orderProvider(widget.orderId).notifier)
          .reportLocation(lat: result.position!.latitude, lng: result.position!.longitude);
    }

    await ping();
    _geofence = Timer.periodic(const Duration(seconds: 60), (_) => unawaited(ping()));
  }

  Future<void> _offerNotifications() async {
    final push = ref.read(pushServiceProvider);
    if (!await push.canPrompt() || !mounted) return;
    final l10n = AppLocalizations.of(context);
    final allow = await showModalBottomSheet<bool>(
      context: context,
      builder: (context) => Padding(
        padding: const EdgeInsets.fromLTRB(24, 0, 24, 24),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Icon(Icons.notifications_active_rounded, size: 48, color: context.brand.caramel),
            const SizedBox(height: 12),
            Text(l10n.notifOrderUpdates, style: context.text.headlineSmall, textAlign: TextAlign.center),
            const SizedBox(height: 8),
            Text(l10n.notifOrderUpdatesHint, textAlign: TextAlign.center, style: context.text.bodyMedium),
            const SizedBox(height: 20),
            PrimaryButton(label: l10n.continueLabel, onPressed: () => Navigator.pop(context, true)),
            TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l10n.close)),
          ],
        ),
      ),
    );
    if (allow ?? false) await push.requestPermission();
  }

  Future<void> _imHere(Order order) async {
    if (_hereBusy || _hereSent) return;
    setState(() => _hereBusy = true);
    final result = await ref.read(locationServiceProvider).locate(timeout: const Duration(seconds: 6));
    try {
      // Without coordinates the explicit tap still counts: the API treats
      // iAmHere as "at the counter" regardless of distance.
      await ref
          .read(orderProvider(order.id).notifier)
          .reportLocation(lat: result.position?.latitude, lng: result.position?.longitude, iAmHere: true);
      unawaited(HapticFeedback.heavyImpact());
      if (mounted) setState(() => _hereSent = true);
    } on Object catch (error) {
      if (mounted) Snack.error(context, error);
    } finally {
      if (mounted) setState(() => _hereBusy = false);
    }
  }

  Future<void> _cancel(Order order) async {
    final l10n = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.cancelOrderTitle),
        content: Text(l10n.cancelOrderBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l10n.keepOrder)),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: context.brand.berry),
            child: Text(l10n.cancelOrder),
          ),
        ],
      ),
    );
    if (ok != true) return;
    try {
      await ref.read(orderProvider(order.id).notifier).cancel();
      unawaited(HapticFeedback.mediumImpact());
    } on Object catch (error) {
      if (mounted) Snack.error(context, error);
    }
  }

  /// Puts the same items back into the cart of the same store.
  Future<void> _reorder(Order order) async {
    if (_reordering) return;
    setState(() => _reordering = true);
    final cart = ref.read(cartProvider(order.storeId).notifier);
    var failed = 0;
    for (final item in order.items) {
      final productId = item.productId;
      if (productId == null) {
        failed++;
        continue;
      }
      try {
        await cart.add(
          productId: productId,
          quantity: item.quantity,
          variationIds: item.variationIds,
          modifiers: item.modifiers,
          notes: item.notes,
        );
      } on Object {
        failed++;
      }
    }
    if (!mounted) return;
    setState(() => _reordering = false);
    final l10n = AppLocalizations.of(context);
    if (failed == order.items.length) {
      Snack.show(context, l10n.reorderPartial, icon: Icons.info_outline_rounded);
      return;
    }
    ref.read(activeStoreIdProvider.notifier).select(order.storeId);
    unawaited(HapticFeedback.mediumImpact());
    if (!mounted) return;
    Snack.show(context, failed > 0 ? l10n.reorderPartial : l10n.reorderDone, icon: Icons.check_circle_rounded);
    final router = GoRouter.of(context)..go(Routes.menu);
    unawaited(router.push(Routes.cart));
  }

  Future<void> _resendReceipt(Order order) async {
    try {
      await ref.read(orderProvider(order.id).notifier).resendReceipt();
      if (mounted) Snack.show(context, AppLocalizations.of(context).receiptSent, icon: Icons.mark_email_read_outlined);
    } on Object catch (error) {
      if (mounted) Snack.error(context, error);
    }
  }

  void _close() {
    final router = GoRouter.of(context);
    if (router.canPop()) {
      router.pop();
    } else {
      router.go(Routes.menu);
    }
  }

  void _showQr(Order order) {
    unawaited(HapticFeedback.selectionClick());
    unawaited(
      showDialog<void>(
        context: context,
        builder: (context) => Dialog(
          backgroundColor: Colors.white,
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                QrImageView(
                  data: order.qrToken,
                  size: 240,
                  backgroundColor: Colors.white,
                  eyeStyle: const QrEyeStyle(eyeShape: QrEyeShape.circle, color: Color(0xFF1A1414)),
                  dataModuleStyle: const QrDataModuleStyle(
                    dataModuleShape: QrDataModuleShape.circle,
                    color: Color(0xFF1A1414),
                  ),
                ),
                const SizedBox(height: 12),
                Text(order.orderCode, style: AppTheme.mono(size: 40, color: const Color(0xFF1A1414), letterSpacing: 6)),
                const SizedBox(height: 4),
                Text(
                  AppLocalizations.of(context).qrHint,
                  style: context.text.bodyMedium?.copyWith(color: const Color(0xFF6B5E54)),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final async = ref.watch(orderProvider(widget.orderId));
    final order = async.valueOrNull;

    // Haptic nudge on every status change after the first render.
    if (order != null) {
      if (_lastStatus != null && _lastStatus != order.status) {
        unawaited(order.status == OrderStatus.ready ? HapticFeedback.heavyImpact() : HapticFeedback.mediumImpact());
      }
      _lastStatus = order.status;
    }

    return Scaffold(
      appBar: AppBar(
        leading: IconButton(icon: const Icon(Icons.close_rounded), onPressed: _close),
        title: Text(order == null ? '' : l10n.orderTitle(order.orderCode)),
        centerTitle: true,
        actions: [if (order != null && !order.status.isTerminal) const _LiveBadge(), const SizedBox(width: 12)],
      ),
      body: order == null
          ? async.hasError
                ? ErrorState(error: async.error!, onRetry: () => ref.invalidate(orderProvider(widget.orderId)))
                : const _OrderSkeleton()
          : RefreshIndicator(
              color: context.brand.caramel,
              onRefresh: () => ref.read(orderProvider(widget.orderId).notifier).refresh(),
              child: _OrderBody(
                order: order,
                now: _now,
                userPosition: _userPosition,
                justPlaced: widget.justPlaced,
                onCancel: () => _cancel(order),
                onReceipt: () => _resendReceipt(order),
                onQr: () => _showQr(order),
              ),
            ),
      bottomNavigationBar: order == null
          ? null
          : _ActionBar(
              order: order,
              hereSent: _hereSent,
              hereBusy: _hereBusy,
              reordering: _reordering,
              onHere: () => _imHere(order),
              onReorder: () => _reorder(order),
            ),
    );
  }
}

/// The one thing to do next, pinned under the thumb rather than below the
/// map and the receipt: "I'm here" while the order is on its way, "Order
/// again" once it is over.
class _ActionBar extends StatelessWidget {
  const _ActionBar({
    required this.order,
    required this.hereSent,
    required this.hereBusy,
    required this.reordering,
    required this.onHere,
    required this.onReorder,
  });

  final Order order;
  final bool hereSent;
  final bool hereBusy;
  final bool reordering;
  final VoidCallback onHere;
  final VoidCallback onReorder;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final status = order.status;
    final canSayHere =
        !order.isDelivery &&
        !status.isTerminal &&
        status != OrderStatus.outForDelivery &&
        status != OrderStatus.unknown;

    final Widget? action = status.isTerminal
        ? PrimaryButton(
            key: const ValueKey('reorder'),
            label: l10n.reorder,
            icon: Icons.replay_rounded,
            loading: reordering,
            onPressed: onReorder,
          )
        : !canSayHere
        ? null
        : hereSent
        ? Container(
            key: const ValueKey('sent'),
            height: 54,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              color: brand.mint.withValues(alpha: 0.15),
              borderRadius: BorderRadius.circular(Radii.button),
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              children: [
                Icon(Icons.waving_hand_rounded, color: brand.mint),
                const SizedBox(width: 8),
                Text(l10n.iAmHereSent, style: context.text.labelLarge),
              ],
            ),
          )
        : PrimaryButton(
            key: const ValueKey('here'),
            label: l10n.iAmHere,
            icon: Icons.where_to_vote_rounded,
            loading: hereBusy,
            onPressed: onHere,
          );

    return AnimatedSize(
      duration: Motion.medium,
      curve: Motion.emphasized,
      child: action == null
          ? const SizedBox(width: double.infinity)
          : SafeArea(
              minimum: const EdgeInsets.fromLTRB(16, 8, 16, 12),
              child: AnimatedSwitcher(duration: Motion.medium, child: action),
            ),
    );
  }
}

class _LiveBadge extends ConsumerWidget {
  const _LiveBadge();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final realtime = ref.watch(realtimeServiceProvider);
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    return ValueListenableBuilder<bool>(
      valueListenable: realtime.connected,
      builder: (context, live, _) => AnimatedSwitcher(
        duration: Motion.medium,
        child: Row(
          key: ValueKey(live),
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              width: 8,
              height: 8,
              decoration: BoxDecoration(color: live ? brand.mint : brand.amber, shape: BoxShape.circle),
            ),
            const SizedBox(width: 6),
            Text(live ? l10n.liveUpdates : l10n.reconnecting, style: context.text.labelSmall),
          ],
        ),
      ),
    );
  }
}

class _OrderBody extends ConsumerWidget {
  const _OrderBody({
    required this.order,
    required this.now,
    required this.userPosition,
    required this.justPlaced,
    required this.onCancel,
    required this.onReceipt,
    required this.onQr,
  });

  final Order order;
  final DateTime now;
  final LatLng? userPosition;
  final bool justPlaced;
  final VoidCallback onCancel;
  final VoidCallback onReceipt;
  final VoidCallback onQr;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final status = order.status;
    final name = ref.watch(currentUserProvider)?.firstName ?? '';
    final showCode = !status.isTerminal;
    final ringSize = (MediaQuery.sizeOf(context).width * 0.62).clamp(200.0, 300.0);

    return ListView(
      padding: const EdgeInsets.fromLTRB(16, 0, 16, 32),
      children: [
        _Entrance(
          enabled: justPlaced,
          child: Column(
            children: [
              if (name.isNotEmpty)
                Text(l10n.hiName(name), style: context.text.bodyLarge?.copyWith(color: brand.textSecondary)),
              const SizedBox(height: 4),
              AnimatedSwitcher(
                duration: Motion.medium,
                child: Text(
                  orderStatusLabel(context, status, delivery: order.isDelivery),
                  key: ValueKey(status),
                  textAlign: TextAlign.center,
                  style: context.text.headlineLarge,
                ),
              ),
              const SizedBox(height: 4),
              Text(
                order.isDelivery
                    ? l10n.deliveryAt(formatClock(context, order.pickupAt))
                    : l10n.pickupAt(formatClock(context, order.pickupAt)),
                style: context.text.bodyMedium?.copyWith(color: brand.textSecondary),
              ),
              const SizedBox(height: 20),
              OrderProgressRing(order: order, now: now, size: ringSize),
            ],
          ),
        ),
        const SizedBox(height: 24),
        OrderStepper(status: status, delivery: order.isDelivery),
        const SizedBox(height: 20),
        _PaymentCard(order: order),
        if (showCode) ...[const SizedBox(height: 12), _CodeCard(order: order, onQr: onQr)],
        const SizedBox(height: 16),
        _StoreCard(order: order, userPosition: userPosition),
        const SizedBox(height: 12),
        _ItemsCard(order: order),
        const SizedBox(height: 16),
        if (status.isCancellable) SecondaryButton(label: l10n.cancelOrder, danger: true, onPressed: onCancel),
        if (!status.isCancelled && status != OrderStatus.created)
          Padding(
            padding: const EdgeInsets.only(top: 8),
            child: TextButton.icon(
              onPressed: onReceipt,
              icon: const Icon(Icons.mail_outline_rounded),
              label: Text(l10n.emailReceipt),
            ),
          ),
      ],
    );
  }
}

class _Entrance extends StatelessWidget {
  const _Entrance({required this.enabled, required this.child});

  final bool enabled;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    if (!enabled) return child;
    return TweenAnimationBuilder<double>(
      tween: Tween(begin: 0, end: 1),
      duration: const Duration(milliseconds: 700),
      curve: Curves.easeOutBack,
      builder: (context, t, child) => Opacity(
        opacity: t.clamp(0, 1),
        child: Transform.scale(scale: 0.85 + 0.15 * t, child: child),
      ),
      child: child,
    );
  }
}

class _PaymentCard extends StatelessWidget {
  const _PaymentCard({required this.order});

  final Order order;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final p = order.payment;
    final (String title, IconData icon, Color color) = switch (p.state) {
      PaymentState.paid => (l10n.paymentStatePaid, Icons.verified_rounded, brand.mint),
      PaymentState.held => (l10n.paymentStateHeld, Icons.lock_clock_rounded, brand.amber),
      PaymentState.pending => (l10n.paymentStatePending, Icons.hourglass_top_rounded, brand.amber),
      PaymentState.failed => (l10n.paymentStateFailed, Icons.error_outline_rounded, brand.berry),
      PaymentState.refunded => (l10n.paymentStateRefunded, Icons.undo_rounded, brand.textSecondary),
      PaymentState.none => (l10n.paymentStateAtCounter, Icons.storefront_rounded, brand.caramel),
    };
    final detail = p.state == PaymentState.none
        ? context.money(order.totalCents, order.currency)
        : [context.money(p.amountCents, order.currency), ?p.cardMask].join(' · ');

    return AnimatedContainer(
      duration: Motion.medium,
      padding: const EdgeInsets.all(14),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.12), borderRadius: BorderRadius.circular(Radii.card)),
      child: Row(
        children: [
          Icon(icon, color: color),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(title, style: context.text.titleSmall),
                Text(detail, style: context.text.bodySmall),
                if (p.state == PaymentState.held) Text(l10n.paymentStateHeldHint, style: context.text.bodySmall),
              ],
            ),
          ),
        ],
      ),
    );
  }
}

class _CodeCard extends StatelessWidget {
  const _CodeCard({required this.order, required this.onQr});

  final Order order;
  final VoidCallback onQr;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    return Container(
      padding: const EdgeInsets.fromLTRB(20, 16, 12, 16),
      decoration: BoxDecoration(
        color: brand.foam,
        borderRadius: BorderRadius.circular(Radii.card),
        border: Border.all(color: brand.caramel, width: 1.5),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(l10n.pickupCode, style: context.text.labelMedium?.copyWith(color: brand.textSecondary)),
                const SizedBox(height: 2),
                Semantics(
                  label: '${l10n.pickupCode} ${order.orderCode.split('').join(' ')}',
                  child: Text(
                    order.orderCode,
                    style: AppTheme.mono(size: 44, weight: FontWeight.w700, color: brand.textPrimary, letterSpacing: 8),
                  ),
                ),
              ],
            ),
          ),
          Material(
            color: brand.caramelSoft,
            borderRadius: BorderRadius.circular(16),
            child: InkWell(
              borderRadius: BorderRadius.circular(16),
              onTap: onQr,
              child: Padding(
                padding: const EdgeInsets.all(10),
                child: Column(
                  children: [
                    QrImageView(
                      data: order.qrToken,
                      size: 56,
                      padding: EdgeInsets.zero,
                      eyeStyle: QrEyeStyle(eyeShape: QrEyeShape.circle, color: brand.textPrimary),
                      dataModuleStyle: QrDataModuleStyle(
                        dataModuleShape: QrDataModuleShape.circle,
                        color: brand.textPrimary,
                      ),
                    ),
                    const SizedBox(height: 4),
                    Text(l10n.showQr, style: context.text.labelSmall),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }
}

class _StoreCard extends StatelessWidget {
  const _StoreCard({required this.order, required this.userPosition});

  final Order order;
  final LatLng? userPosition;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final address = order.storeAddress;
    final hasAddress = address != null && address.trim().isNotEmpty && address.trim() != '—';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: brand.foam,
        borderRadius: BorderRadius.circular(Radii.card),
        border: Border.all(color: brand.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Row(
            children: [
              Icon(Icons.storefront_rounded, color: brand.caramel),
              const SizedBox(width: 10),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(order.storeName, style: context.text.titleSmall),
                    if (hasAddress) Text(address, style: context.text.bodySmall),
                  ],
                ),
              ),
            ],
          ),
          if (order.hasStoreLocation) ...[
            const SizedBox(height: 12),
            StaticStoreMap(lat: order.storeLatitude, lng: order.storeLongitude, user: userPosition),
            const SizedBox(height: 12),
            OutlinedButton.icon(
              onPressed: () => openDirections(order.storeLatitude, order.storeLongitude, label: order.storeName),
              icon: const Icon(Icons.directions_rounded),
              label: Text(l10n.buildRoute),
            ),
          ],
        ],
      ),
    );
  }
}

class _ItemsCard extends ConsumerWidget {
  const _ItemsCard({required this.order});

  final Order order;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final currency = order.currency;
    final discount = order.discountCents;

    Widget line(String label, int cents, {bool strong = false, bool minus = false}) => Padding(
      padding: const EdgeInsets.symmetric(vertical: 3),
      child: Row(
        children: [
          Expanded(child: Text(label, style: strong ? context.text.titleMedium : context.text.bodyMedium)),
          Text(
            '${minus ? '− ' : ''}${context.money(cents, currency)}',
            style: strong
                ? context.text.titleMedium
                : context.text.bodyMedium?.copyWith(color: minus ? brand.mint : brand.textSecondary),
          ),
        ],
      ),
    );

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: brand.foam,
        borderRadius: BorderRadius.circular(Radii.card),
        border: Border.all(color: brand.borderLight),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(l10n.orderItems, style: context.text.titleMedium),
          const SizedBox(height: 8),
          for (final item in order.items)
            Padding(
              padding: const EdgeInsets.symmetric(vertical: 4),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('${item.quantity}×', style: context.text.titleSmall?.copyWith(color: brand.caramel)),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(item.name, style: context.text.bodyMedium),
                        if (item.productId != null) _ItemOptions(productId: item.productId!, item: item),
                      ],
                    ),
                  ),
                  Text(context.money(item.totalCents, currency), style: context.text.bodyMedium),
                ],
              ),
            ),
          const Divider(height: 20),
          line(l10n.subtotal, order.subtotalCents),
          if (discount > 0) line(l10n.discountsTitle, discount, minus: true),
          if (order.deliveryFeeCents > 0) line(l10n.deliveryFee, order.deliveryFeeCents),
          if (order.giftCardCents > 0) line(l10n.giftCard, order.giftCardCents, minus: true),
          if (order.taxCents > 0) line(l10n.tax, order.taxCents),
          line(l10n.total, order.totalCents, strong: true),
        ],
      ),
    );
  }
}

class _ItemOptions extends ConsumerWidget {
  const _ItemOptions({required this.productId, required this.item});

  final String productId;
  final OrderItem item;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (item.variationIds.isEmpty && item.modifiers.isEmpty && (item.notes ?? '').isEmpty) {
      return const SizedBox.shrink();
    }
    final detail = ref.watch(productDetailProvider(productId)).valueOrNull;
    final parts = <String>[
      if (detail != null)
        for (final v in detail.variations)
          if (item.variationIds.contains(v.id)) v.name,
      if (detail != null)
        for (final m in detail.modifiers)
          if ((item.modifiers[m.id] ?? 0) > 0)
            item.modifiers[m.id]! > 1 ? '${item.modifiers[m.id]}× ${m.name}' : m.name,
      if ((item.notes ?? '').isNotEmpty) '“${item.notes}”',
    ];
    if (parts.isEmpty) return const SizedBox.shrink();
    return Text(parts.join(' · '), style: context.text.bodySmall);
  }
}

class _OrderSkeleton extends StatelessWidget {
  const _OrderSkeleton();

  @override
  Widget build(BuildContext context) {
    return const ShimmerScope(
      child: Padding(
        padding: EdgeInsets.all(24),
        child: Column(
          children: [
            Skeleton(width: 200, height: 28),
            SizedBox(height: 24),
            Skeleton.circle(size: 240),
            SizedBox(height: 24),
            Skeleton(height: 64, radius: Radii.card),
            SizedBox(height: 12),
            Skeleton(height: 96, radius: Radii.card),
          ],
        ),
      ),
    );
  }
}
