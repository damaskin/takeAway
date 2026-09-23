import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';

import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/money_text.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import 'profile_providers.dart';

class GiftCardsScreen extends ConsumerWidget {
  const GiftCardsScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final async = ref.watch(giftCardsProvider);
    final locale = Localizations.localeOf(context).toLanguageTag();

    return Scaffold(
      appBar: AppBar(title: Text(l10n.giftCardsTitle)),
      body: async.when(
        loading: () => const ShimmerScope(
          child: Padding(
            padding: EdgeInsets.all(16),
            child: Skeleton(height: 80, radius: Radii.card),
          ),
        ),
        error: (error, _) => ErrorState(error: error, onRetry: () => ref.invalidate(giftCardsProvider)),
        data: (cards) => cards.isEmpty
            ? EmptyState(icon: Icons.card_giftcard_rounded, title: l10n.giftCardsTitle, message: l10n.giftCardsEmpty)
            : ListView.separated(
                padding: const EdgeInsets.all(16),
                itemCount: cards.length,
                separatorBuilder: (_, _) => const SizedBox(height: 10),
                itemBuilder: (context, index) {
                  final card = cards[index];
                  return Container(
                    padding: const EdgeInsets.all(16),
                    decoration: BoxDecoration(
                      color: brand.foam,
                      borderRadius: BorderRadius.circular(Radii.card),
                      border: Border.all(color: brand.borderLight),
                    ),
                    child: Row(
                      children: [
                        Icon(Icons.card_giftcard_rounded, color: brand.caramel),
                        const SizedBox(width: 12),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(card.code, style: context.text.titleSmall),
                              Text(l10n.giftCardUsedOn(card.orderCode, card.brandName), style: context.text.bodySmall),
                              Text(
                                DateFormat.yMMMd(locale).format(card.createdAt.toLocal()),
                                style: context.text.bodySmall,
                              ),
                            ],
                          ),
                        ),
                        Text('− ${context.money(card.amountCents, card.currency)}', style: context.text.titleSmall),
                      ],
                    ),
                  );
                },
              ),
      ),
    );
  }
}
