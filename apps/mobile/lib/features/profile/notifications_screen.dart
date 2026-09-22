import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/push/push_service.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import 'profile_providers.dart';

class NotificationsScreen extends ConsumerWidget {
  const NotificationsScreen({super.key});

  Future<void> _set(BuildContext context, WidgetRef ref, {bool? orders, bool? promos}) async {
    unawaited(HapticFeedback.selectionClick());
    try {
      await ref.read(notificationPrefsProvider.notifier).set(orderUpdates: orders, promotions: promos);
      // Turning updates on is the moment to ask the OS for permission.
      if ((orders ?? false) || (promos ?? false)) await ref.read(pushServiceProvider).requestPermission();
    } on Object catch (error) {
      if (context.mounted) Snack.error(context, error);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final async = ref.watch(notificationPrefsProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.notificationsTitle)),
      body: async.when(
        loading: () => const ShimmerScope(
          child: Padding(
            padding: EdgeInsets.all(16),
            child: Skeleton(height: 140, radius: Radii.card),
          ),
        ),
        error: (error, _) => ErrorState(error: error, onRetry: () => ref.invalidate(notificationPrefsProvider)),
        data: (prefs) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(l10n.notificationsSubtitle, style: context.text.bodyMedium?.copyWith(color: brand.textSecondary)),
            const SizedBox(height: 16),
            Container(
              decoration: BoxDecoration(
                color: brand.foam,
                borderRadius: BorderRadius.circular(Radii.card),
                border: Border.all(color: brand.borderLight),
              ),
              child: Column(
                children: [
                  SwitchListTile.adaptive(
                    value: prefs.notifyOrderUpdates,
                    onChanged: (v) => _set(context, ref, orders: v),
                    secondary: Icon(Icons.local_cafe_outlined, color: brand.caramel),
                    title: Text(l10n.notifOrderUpdates),
                    subtitle: Text(l10n.notifOrderUpdatesHint),
                  ),
                  Divider(indent: 72, color: brand.borderLight),
                  SwitchListTile.adaptive(
                    value: prefs.notifyPromotions,
                    onChanged: (v) => _set(context, ref, promos: v),
                    secondary: Icon(Icons.local_offer_outlined, color: brand.caramel),
                    title: Text(l10n.notifPromotions),
                    subtitle: Text(l10n.notifPromotionsHint),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
