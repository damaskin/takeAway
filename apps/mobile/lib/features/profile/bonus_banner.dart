import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';

import '../../app/router.dart';
import '../../core/storage/app_prefs.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/pressable.dart';
import 'profile_providers.dart';

/// «Мои бонусы» on the profile while the customer holds an unused welcome
/// bonus: «Приветственный бонус −10%», «На заказ в любом заведении · до 17
/// ноября». A tap takes them to ordering — the menu of the store picked last
/// time, else the store list — where checkout applies the bonus by itself.
/// Nothing at all without a bonus.
class BonusBanner extends ConsumerWidget {
  const BonusBanner({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final bonus = ref.watch(activeBonusProvider);
    if (bonus == null) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final locale = Localizations.localeOf(context).languageCode;
    final until = DateFormat.MMMMd(locale).format(bonus.expiresAt.toLocal());

    return Padding(
      padding: const EdgeInsets.only(bottom: 16),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.only(left: 4, bottom: 8),
            child: Text(l10n.bonusesTitle, style: context.text.titleMedium),
          ),
          Pressable(
            onTap: () => context.go(ref.read(activeStoreIdProvider) == null ? Routes.stores : Routes.menu),
            child: Container(
              key: const ValueKey('welcome-bonus'),
              padding: const EdgeInsets.all(16),
              decoration: BoxDecoration(
                color: brand.caramelSoft,
                borderRadius: BorderRadius.circular(Radii.card),
                border: Border.all(color: brand.caramel.withValues(alpha: 0.35)),
              ),
              child: Row(
                children: [
                  Container(
                    width: 44,
                    height: 44,
                    alignment: Alignment.center,
                    decoration: BoxDecoration(color: brand.caramel, shape: BoxShape.circle),
                    child: const Icon(Icons.redeem_rounded, color: Colors.white),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(l10n.welcomeBonusTitle(bonus.percent), style: context.text.titleMedium),
                        const SizedBox(height: 2),
                        Text(l10n.bonusAnyVenueUntil(until), style: context.text.bodySmall),
                      ],
                    ),
                  ),
                  Icon(Icons.chevron_right_rounded, color: brand.textTertiary),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
