import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../l10n/app_localizations.dart';
import '../../shared/widgets/app_button.dart';
import '../providers.dart';
import '../theme/tokens.dart';
import 'push_service.dart';

/// Whether the after-sign-in offer was shown on this install — it is made once.
const _offeredAfterSignInKey = 'push.offeredAfterSignIn';

/// Explains what the notifications are for, then — on "Continue" — shows
/// the system prompt. Only when the phone has never been asked: the OS
/// prompts once, so a refusal at a random moment would be final. Completes
/// with whether notifications are allowed now.
Future<bool> offerNotifications(BuildContext context, WidgetRef ref) async {
  final push = ref.read(pushServiceProvider);
  if (!await push.canPrompt() || !context.mounted) return false;
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
  if (!(allow ?? false)) return false;
  return push.requestPermission();
}

/// Right after signing in — the moment the account exists that pushes are
/// sent to — offers notifications once per install, if the phone was never
/// asked. A phone that already allows them has its device registered by the
/// sign-in itself ([PushService.syncToken]).
Future<void> offerNotificationsAfterSignIn(BuildContext context, WidgetRef ref) async {
  final prefs = ref.read(sharedPreferencesProvider);
  if (prefs.getBool(_offeredAfterSignInKey) ?? false) return;
  if (!await ref.read(pushServiceProvider).canPrompt() || !context.mounted) return;
  await prefs.setBool(_offeredAfterSignInKey, true);
  if (!context.mounted) return;
  await offerNotifications(context, ref);
}
