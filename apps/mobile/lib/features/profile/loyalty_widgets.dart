import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../app/router.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/skeleton.dart';
import 'profile_providers.dart';

String tierName(AppLocalizations l10n, LoyaltyTier tier) => switch (tier) {
  LoyaltyTier.silver => l10n.tierSilver,
  LoyaltyTier.gold => l10n.tierGold,
  LoyaltyTier.platinum => l10n.tierPlatinum,
  LoyaltyTier.signature => l10n.tierSignature,
};

List<Color> tierGradient(LoyaltyTier tier) => switch (tier) {
  LoyaltyTier.silver => const [Color(0xFF8E9AA6), Color(0xFF5C6773)],
  LoyaltyTier.gold => const [Color(0xFFE2B45A), Color(0xFFB07A24)],
  LoyaltyTier.platinum => const [Color(0xFF6D7F95), Color(0xFF2E3B4E)],
  LoyaltyTier.signature => const [Color(0xFF3A2A22), Color(0xFF1A1414)],
};

/// Wallet-style loyalty card: tier, balance and progress to the next tier.
class LoyaltyCard extends StatelessWidget {
  const LoyaltyCard({required this.account, this.onTap, super.key});

  final LoyaltyAccount account;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final next = account.nextTier;
    return Pressable(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.all(20),
        decoration: BoxDecoration(
          borderRadius: BorderRadius.circular(Radii.card),
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: tierGradient(account.tier),
          ),
          boxShadow: [
            BoxShadow(
              color: tierGradient(account.tier).last.withValues(alpha: 0.35),
              blurRadius: 24,
              offset: const Offset(0, 10),
            ),
          ],
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const Icon(Icons.stars_rounded, color: Colors.white, size: 22),
                const SizedBox(width: 8),
                Text(
                  tierName(l10n, account.tier).toUpperCase(),
                  style: context.text.labelLarge?.copyWith(color: Colors.white, letterSpacing: 1.6),
                ),
                const Spacer(),
                if (onTap != null) const Icon(Icons.chevron_right_rounded, color: Colors.white70),
              ],
            ),
            const SizedBox(height: 18),
            TweenAnimationBuilder<double>(
              tween: Tween(begin: 0, end: account.pointsBalance.toDouble()),
              duration: const Duration(milliseconds: 900),
              curve: Curves.easeOutCubic,
              builder: (context, value, _) => Text(
                '${value.round()}',
                style: AppTheme.mono(size: 38, weight: FontWeight.w700, color: Colors.white),
              ),
            ),
            Text(l10n.loyaltyBalance, style: context.text.bodySmall?.copyWith(color: Colors.white70)),
            const SizedBox(height: 16),
            if (next != null) ...[
              ClipRRect(
                borderRadius: BorderRadius.circular(4),
                child: TweenAnimationBuilder<double>(
                  tween: Tween(begin: 0, end: account.tierProgressPercent / 100),
                  duration: const Duration(milliseconds: 900),
                  curve: Curves.easeOutCubic,
                  builder: (context, value, _) => LinearProgressIndicator(
                    value: value,
                    minHeight: 6,
                    color: Colors.white,
                    backgroundColor: Colors.white.withValues(alpha: 0.25),
                  ),
                ),
              ),
              const SizedBox(height: 8),
              Text(
                l10n.toNextTier(account.pointsToNextTier, tierName(l10n, next)),
                style: context.text.bodySmall?.copyWith(color: Colors.white),
              ),
            ] else
              Text(l10n.topTier, style: context.text.bodySmall?.copyWith(color: Colors.white)),
          ],
        ),
      ),
    );
  }
}

class LoyaltyCardTile extends ConsumerWidget {
  const LoyaltyCardTile({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final async = ref.watch(loyaltyProvider);
    final account = async.valueOrNull;
    if (account == null) {
      return async.isLoading
          ? const ShimmerScope(child: Skeleton(height: 180, radius: Radii.card))
          : const SizedBox.shrink();
    }
    return LoyaltyCard(account: account, onTap: () => context.push(Routes.loyalty));
  }
}
