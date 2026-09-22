import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:share_plus/share_plus.dart';

import '../../core/config/env.dart';
import '../../core/providers.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import 'profile_providers.dart';

class ReferralsScreen extends ConsumerStatefulWidget {
  const ReferralsScreen({super.key});

  @override
  ConsumerState<ReferralsScreen> createState() => _ReferralsScreenState();
}

class _ReferralsScreenState extends ConsumerState<ReferralsScreen> {
  final _code = TextEditingController();
  bool _applying = false;

  @override
  void dispose() {
    _code.dispose();
    super.dispose();
  }

  Future<void> _apply() async {
    final code = _code.text.trim();
    if (code.isEmpty) return;
    setState(() => _applying = true);
    try {
      await ref.read(apiProvider).applyReferral({'code': code});
      ref.invalidate(referralsProvider);
      unawaited(HapticFeedback.mediumImpact());
    } on Object catch (error) {
      if (mounted) Snack.error(context, error);
    } finally {
      if (mounted) setState(() => _applying = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final async = ref.watch(referralsProvider);

    return Scaffold(
      appBar: AppBar(title: Text(l10n.referralsTitle)),
      body: async.when(
        loading: () => const ShimmerScope(
          child: Padding(
            padding: EdgeInsets.all(16),
            child: Skeleton(height: 200, radius: Radii.card),
          ),
        ),
        error: (error, _) => ErrorState(error: error, onRetry: () => ref.invalidate(referralsProvider)),
        data: (summary) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(l10n.referralsBody, style: context.text.bodyLarge?.copyWith(color: brand.textSecondary)),
            const SizedBox(height: 20),
            Container(
              padding: const EdgeInsets.all(20),
              decoration: BoxDecoration(
                color: brand.foam,
                borderRadius: BorderRadius.circular(Radii.card),
                border: Border.all(color: brand.caramel, width: 1.5),
              ),
              child: Column(
                children: [
                  Text(l10n.referralsYourCode, style: context.text.labelMedium?.copyWith(color: brand.textSecondary)),
                  const SizedBox(height: 6),
                  SelectableText(
                    summary.code,
                    style: AppTheme.mono(size: 32, weight: FontWeight.w700, color: brand.textPrimary, letterSpacing: 4),
                  ),
                  const SizedBox(height: 16),
                  Row(
                    children: [
                      Expanded(
                        child: SecondaryButton(
                          label: l10n.copy,
                          icon: Icons.copy_rounded,
                          onPressed: () async {
                            await Clipboard.setData(ClipboardData(text: summary.code));
                            unawaited(HapticFeedback.selectionClick());
                            if (context.mounted) Snack.show(context, l10n.referralsCopied, icon: Icons.check_rounded);
                          },
                        ),
                      ),
                      const SizedBox(width: 10),
                      Expanded(
                        child: FilledButton.icon(
                          onPressed: () => SharePlus.instance.share(
                            ShareParams(text: l10n.referralsShareText(summary.code, Env.webOrigin)),
                          ),
                          icon: const Icon(Icons.ios_share_rounded),
                          label: Text(l10n.referralsShare),
                        ),
                      ),
                    ],
                  ),
                ],
              ),
            ),
            const SizedBox(height: 16),
            Row(
              children: [
                _Stat(value: summary.signupsCount, label: l10n.referralsSignups),
                const SizedBox(width: 10),
                _Stat(value: summary.rewardedCount, label: l10n.referralsRewarded),
                const SizedBox(width: 10),
                _Stat(value: summary.pointsEarned, label: l10n.referralsPoints),
              ],
            ),
            const SizedBox(height: 24),
            if (summary.appliedCode != null)
              Container(
                padding: const EdgeInsets.all(14),
                decoration: BoxDecoration(
                  color: brand.mint.withValues(alpha: 0.14),
                  borderRadius: BorderRadius.circular(Radii.button),
                ),
                child: Row(
                  children: [
                    Icon(Icons.verified_rounded, color: brand.mint),
                    const SizedBox(width: 10),
                    Expanded(child: Text(l10n.referralsApplied(summary.appliedCode!))),
                  ],
                ),
              )
            else ...[
              Text(l10n.referralsApplyTitle, style: context.text.titleMedium),
              const SizedBox(height: 4),
              Text(l10n.referralsApplyHint, style: context.text.bodySmall),
              const SizedBox(height: 12),
              TextField(
                controller: _code,
                textCapitalization: TextCapitalization.characters,
                decoration: InputDecoration(labelText: l10n.referralsCodeHint),
              ),
              const SizedBox(height: 12),
              PrimaryButton(label: l10n.apply, loading: _applying, onPressed: _apply),
            ],
          ],
        ),
      ),
    );
  }
}

class _Stat extends StatelessWidget {
  const _Stat({required this.value, required this.label});

  final int value;
  final String label;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return Expanded(
      child: Container(
        padding: const EdgeInsets.symmetric(vertical: 14, horizontal: 8),
        decoration: BoxDecoration(color: brand.caramelSoft, borderRadius: BorderRadius.circular(Radii.button)),
        child: Column(
          children: [
            Text('$value', style: context.text.headlineMedium),
            const SizedBox(height: 2),
            Text(label, textAlign: TextAlign.center, style: context.text.bodySmall),
          ],
        ),
      ),
    );
  }
}
