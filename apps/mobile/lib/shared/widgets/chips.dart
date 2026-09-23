import 'package:flutter/material.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/format/time.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';

/// "~7 min" pill tinted by how busy the kitchen is.
class EtaChip extends StatelessWidget {
  const EtaChip({required this.etaSeconds, required this.busyMeter, this.dense = false, super.key});

  final int etaSeconds;
  final int busyMeter;
  final bool dense;

  @override
  Widget build(BuildContext context) {
    final color = context.brand.busy(busyMeter);
    return Container(
      padding: EdgeInsets.symmetric(horizontal: dense ? 8 : 10, vertical: dense ? 3 : 5),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.16), borderRadius: BorderRadius.circular(Radii.pill)),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.schedule_rounded, size: dense ? 13 : 15, color: Color.lerp(color, Colors.black, 0.25)),
          const SizedBox(width: 4),
          Text(
            AppLocalizations.of(context).etaChip(minutesCeil(etaSeconds)),
            style: context.text.labelMedium?.copyWith(
              color: Color.lerp(color, Colors.black, 0.35),
              fontWeight: FontWeight.w700,
              fontSize: dense ? 11 : 12,
            ),
          ),
        ],
      ),
    );
  }
}

class StoreStatusBadge extends StatelessWidget {
  const StoreStatusBadge({required this.status, super.key});

  final StoreStatus status;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final (label, color) = switch (status) {
      StoreStatus.open => (l10n.storeStatusOpen, brand.mint),
      StoreStatus.overloaded => (l10n.storeStatusBusy, brand.amber),
      StoreStatus.closed || StoreStatus.unknown => (l10n.storeStatusClosed, brand.berry),
    };
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        Container(
          width: 8,
          height: 8,
          decoration: BoxDecoration(color: color, shape: BoxShape.circle),
        ),
        const SizedBox(width: 6),
        Text(label, style: context.text.labelMedium?.copyWith(color: brand.textSecondary)),
      ],
    );
  }
}

/// Order status as a coloured pill.
class OrderStatusBadge extends StatelessWidget {
  const OrderStatusBadge({required this.status, this.delivery = false, super.key});

  final OrderStatus status;
  final bool delivery;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final color = orderStatusColor(context, status);
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
      decoration: BoxDecoration(color: color.withValues(alpha: 0.15), borderRadius: BorderRadius.circular(Radii.pill)),
      child: Text(
        orderStatusLabel(context, status, delivery: delivery),
        style: context.text.labelSmall?.copyWith(
          color: status.isCancelled ? brand.berry : Color.lerp(color, Colors.black, 0.35),
          fontWeight: FontWeight.w700,
        ),
      ),
    );
  }
}

Color orderStatusColor(BuildContext context, OrderStatus status) {
  final brand = context.brand;
  return switch (status) {
    OrderStatus.ready || OrderStatus.pickedUp || OrderStatus.delivered => brand.mint,
    OrderStatus.inProgress || OrderStatus.accepted || OrderStatus.outForDelivery => brand.amber,
    OrderStatus.cancelled || OrderStatus.expired => brand.berry,
    _ => brand.caramel,
  };
}

String orderStatusLabel(BuildContext context, OrderStatus status, {bool delivery = false}) {
  final l10n = AppLocalizations.of(context);
  return switch (status) {
    OrderStatus.created => l10n.statusCreated,
    OrderStatus.paid => l10n.statusPaid,
    OrderStatus.accepted => l10n.statusAccepted,
    OrderStatus.inProgress => l10n.statusInProgress,
    OrderStatus.ready => delivery ? l10n.statusReadyDelivery : l10n.statusReady,
    OrderStatus.pickedUp => l10n.statusPickedUp,
    OrderStatus.outForDelivery => l10n.statusOutForDelivery,
    OrderStatus.delivered => l10n.statusDelivered,
    OrderStatus.cancelled => l10n.statusCancelled,
    OrderStatus.expired => l10n.statusExpired,
    OrderStatus.unknown => l10n.statusUnknown,
  };
}

/// Diet tag chip label.
String dietTagLabel(AppLocalizations l10n, String tag) => switch (tag) {
  'VEGAN' => l10n.dietVegan,
  'VEGETARIAN' => l10n.dietVegetarian,
  'GLUTEN_FREE' => l10n.dietGlutenFree,
  'LACTOSE_FREE' => l10n.dietLactoseFree,
  'DECAF' => l10n.dietDecaf,
  'SUGAR_FREE' => l10n.dietSugarFree,
  _ => tag,
};
