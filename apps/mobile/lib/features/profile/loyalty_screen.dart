import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import 'loyalty_widgets.dart';
import 'profile_providers.dart';

class LoyaltyScreen extends ConsumerWidget {
  const LoyaltyScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final async = ref.watch(loyaltyProvider);
    final locale = Localizations.localeOf(context).toLanguageTag();

    return Scaffold(
      appBar: AppBar(title: Text(l10n.loyaltyTitle)),
      body: RefreshIndicator(
        color: brand.caramel,
        onRefresh: () => ref.refresh(loyaltyProvider.future),
        child: async.when(
          loading: () => const ShimmerScope(
            child: Padding(
              padding: EdgeInsets.all(16),
              child: Skeleton(height: 190, radius: Radii.card),
            ),
          ),
          error: (error, _) => ListView(
            children: [ErrorState(error: error, onRetry: () => ref.invalidate(loyaltyProvider))],
          ),
          data: (account) => account == null
              ? const SizedBox.shrink()
              : ListView(
                  padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
                  children: [
                    LoyaltyCard(account: account),
                    const SizedBox(height: 20),
                    Container(
                      padding: const EdgeInsets.all(16),
                      decoration: BoxDecoration(
                        color: brand.caramelSoft,
                        borderRadius: BorderRadius.circular(Radii.card),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(l10n.loyaltyHowTitle, style: context.text.titleSmall),
                          const SizedBox(height: 4),
                          Text(l10n.loyaltyHowBody, style: context.text.bodySmall),
                        ],
                      ),
                    ),
                    const SizedBox(height: 20),
                    Text(l10n.loyaltyActivity, style: context.text.titleMedium),
                    const SizedBox(height: 8),
                    if (account.recent.isEmpty)
                      EmptyState(icon: Icons.stars_outlined, title: l10n.loyaltyEmpty, compact: true)
                    else
                      for (final entry in account.recent)
                        ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: CircleAvatar(
                            backgroundColor: (entry.amount >= 0 ? brand.mint : brand.berry).withValues(alpha: 0.15),
                            child: Icon(
                              entry.amount >= 0 ? Icons.add_rounded : Icons.remove_rounded,
                              color: entry.amount >= 0 ? brand.mint : brand.berry,
                            ),
                          ),
                          title: Text(entry.reason),
                          subtitle: Text(DateFormat.yMMMd(locale).add_Hm().format(entry.createdAt.toLocal())),
                          trailing: Text(
                            '${entry.amount >= 0 ? '+' : ''}${entry.amount}',
                            style: context.text.titleMedium?.copyWith(
                              color: entry.amount >= 0 ? brand.mint : brand.berry,
                            ),
                          ),
                        ),
                  ],
                ),
        ),
      ),
    );
  }
}
