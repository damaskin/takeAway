import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../app/app_root.dart';
import '../../core/config/env.dart';
import '../../core/config/stand.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';

/// The hidden stand picker for testers: a long press on the logo of the
/// sign-in sheet or of «О приложении». Switching signs out and starts the
/// app over on the other server (see [AppRoot]) — tokens, orders and cached
/// menus of one server mean nothing on the other.
Future<void> showStandSheet(BuildContext context) {
  unawaited(HapticFeedback.mediumImpact());
  return showModalBottomSheet<void>(
    context: context,
    useRootNavigator: true,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => const _StandSheet(),
  );
}

/// What a stand is called in the sheet and on [StandBadge].
String standLabel(AppLocalizations l10n, Stand stand) => switch (stand) {
  Stand.prod => l10n.standProd,
  Stand.test => l10n.standTest,
  Stand.local => l10n.standLocal,
};

class _StandSheet extends StatefulWidget {
  const _StandSheet();

  @override
  State<_StandSheet> createState() => _StandSheetState();
}

class _StandSheetState extends State<_StandSheet> {
  Stand? _switching;

  Future<void> _pick(Stand stand) async {
    if (_switching != null) return;
    final switcher = StandSwitch.maybeOf(context);
    if (stand == Env.stand || switcher == null) {
      Navigator.of(context).pop();
      return;
    }
    setState(() => _switching = stand);
    unawaited(HapticFeedback.mediumImpact());
    try {
      // The app starts over on the new stand; this sheet goes with the old one.
      await switcher.onSwitch(stand);
    } on Object catch (error) {
      debugPrint('Stand switch failed: $error');
      if (mounted) setState(() => _switching = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    return SingleChildScrollView(
      padding: const EdgeInsets.fromLTRB(8, 0, 8, 16),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Text(l10n.standTitle, style: context.text.headlineSmall),
                const SizedBox(height: 6),
                Text(l10n.standHint, style: context.text.bodyMedium?.copyWith(color: brand.textSecondary)),
              ],
            ),
          ),
          const SizedBox(height: 8),
          for (final stand in Stand.available)
            ListTile(
              enabled: _switching == null || _switching == stand,
              title: Text(standLabel(l10n, stand)),
              subtitle: Text(stand.host),
              trailing: stand == _switching
                  ? const SizedBox.square(dimension: 22, child: CircularProgressIndicator(strokeWidth: 2.5))
                  : stand == Env.stand
                  ? Icon(Icons.check_rounded, color: brand.caramel)
                  : null,
              onTap: () => unawaited(_pick(stand)),
            ),
        ],
      ),
    );
  }
}

/// «Сервер «Тест» · test-api.takeaway.md» under the logo, off production.
class StandBadge extends StatelessWidget {
  const StandBadge({super.key});

  @override
  Widget build(BuildContext context) {
    final stand = Env.stand;
    if (stand == Stand.prod) return const SizedBox.shrink();
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    return Center(
      child: Container(
        margin: const EdgeInsets.only(top: 8),
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 5),
        decoration: BoxDecoration(
          color: brand.amber.withValues(alpha: 0.18),
          borderRadius: BorderRadius.circular(Radii.pill),
        ),
        child: Text(
          l10n.standBadge(standLabel(l10n, stand), stand.host),
          style: context.text.labelMedium?.copyWith(color: brand.textPrimary),
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}
