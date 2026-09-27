import 'dart:async';
import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/providers.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import '../auth/auth_service.dart';

final signInMethodsProvider = FutureProvider.autoDispose<SignInMethods>(
  (ref) => ref.watch(authServiceProvider).signInMethods(),
);

/// Profile → Sign-in methods: which of Telegram, Google and Apple lead into
/// this profile, with a button to connect the rest.
class SignInMethodsScreen extends ConsumerStatefulWidget {
  const SignInMethodsScreen({super.key});

  @override
  ConsumerState<SignInMethodsScreen> createState() => _SignInMethodsScreenState();
}

class _SignInMethodsScreenState extends ConsumerState<SignInMethodsScreen> {
  SignInProvider? _busy;

  static String _label(SignInProvider provider) => switch (provider) {
    SignInProvider.telegram => 'Telegram',
    SignInProvider.google => 'Google',
    SignInProvider.apple => 'Apple',
  };

  Future<void> _link(SignInProvider provider) async {
    if (_busy != null) return;
    final l10n = AppLocalizations.of(context);
    final userBefore = ref.read(currentUserProvider)?.id;
    setState(() => _busy = provider);
    try {
      await ref.read(authServiceProvider).link(provider);
      unawaited(HapticFeedback.mediumImpact());
      if (!mounted) return;
      ref.invalidate(signInMethodsProvider);
      if (ref.read(currentUserProvider)?.id != userBefore) {
        Snack.show(context, l10n.signInMethodSwitched, icon: Icons.swap_horiz_rounded);
      }
    } on SignInCancelled {
      // Backed out of the provider's own screen; nothing to say.
    } on Object catch (error) {
      if (mounted) Snack.error(context, error);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  Future<void> _unlink(SignInProvider provider) async {
    if (_busy != null) return;
    final l10n = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.signInMethodUnlinkConfirm(_label(provider))),
        content: Text(l10n.signInMethodUnlinkHint(_label(provider))),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l10n.cancel)),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: context.brand.berry),
            child: Text(l10n.signInMethodUnlink),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    setState(() => _busy = provider);
    try {
      await ref.read(authServiceProvider).unlink(provider);
      ref.invalidate(signInMethodsProvider);
    } on Object catch (error) {
      if (mounted) Snack.error(context, error);
    } finally {
      if (mounted) setState(() => _busy = null);
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final methods = ref.watch(signInMethodsProvider);
    final options = ref.watch(signInOptionsProvider).valueOrNull;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.signInMethodsTitle)),
      body: methods.when(
        loading: () => const ShimmerScope(
          child: Padding(
            padding: EdgeInsets.all(16),
            child: Skeleton(height: 200, radius: Radii.card),
          ),
        ),
        error: (error, _) => ErrorState(error: error, onRetry: () => ref.invalidate(signInMethodsProvider)),
        data: (m) => ListView(
          padding: const EdgeInsets.all(16),
          children: [
            Text(l10n.signInMethodsSubtitle, style: context.text.bodyMedium?.copyWith(color: brand.textSecondary)),
            const SizedBox(height: 16),
            Container(
              decoration: BoxDecoration(
                color: brand.foam,
                borderRadius: BorderRadius.circular(Radii.card),
                border: Border.all(color: brand.borderLight),
              ),
              child: Column(
                children: [
                  for (final (i, provider) in SignInProvider.values.indexed) ...[
                    if (i > 0) Divider(indent: 72, color: brand.borderLight),
                    _MethodRow(
                      provider: provider,
                      label: _label(provider),
                      linked: switch (provider) {
                        SignInProvider.telegram => m.telegram,
                        SignInProvider.google => m.google,
                        SignInProvider.apple => m.apple,
                      },
                      // Telegram is never removed (the Mini App signs in by it
                      // without asking), and the last way in stays put.
                      canUnlink: provider != SignInProvider.telegram && m.count > 1,
                      canLink: options?.offers(provider) ?? false,
                      busy: _busy == provider,
                      onLink: () => _link(provider),
                      onUnlink: () => _unlink(provider),
                    ),
                  ],
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _MethodRow extends StatelessWidget {
  const _MethodRow({
    required this.provider,
    required this.label,
    required this.linked,
    required this.canUnlink,
    required this.canLink,
    required this.busy,
    required this.onLink,
    required this.onUnlink,
  });

  final SignInProvider provider;
  final String label;
  final bool linked;
  final bool canUnlink;
  final bool canLink;
  final bool busy;
  final VoidCallback onLink;
  final VoidCallback onUnlink;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final icon = switch (provider) {
      SignInProvider.telegram => Icons.send_rounded,
      SignInProvider.google => Icons.g_mobiledata_rounded,
      SignInProvider.apple => Icons.apple,
    };

    Widget? trailing;
    if (busy) {
      trailing = const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4));
    } else if (linked && canUnlink) {
      trailing = TextButton(
        onPressed: onUnlink,
        style: TextButton.styleFrom(foregroundColor: brand.berry),
        child: Text(l10n.signInMethodUnlink),
      );
    } else if (!linked && canLink) {
      trailing = FilledButton(onPressed: onLink, child: Text(l10n.signInMethodLink));
    } else if (linked) {
      trailing = Icon(Icons.check_circle_rounded, color: brand.caramel);
    }

    return ListTile(
      leading: Icon(icon, color: brand.caramel, size: 28),
      title: Text(label),
      subtitle: Text(
        linked
            ? l10n.signInMethodLinked
            : provider == SignInProvider.apple && !Platform.isIOS
            ? l10n.signInMethodIosOnly
            : l10n.signInMethodNotLinked,
      ),
      trailing: trailing,
    );
  }
}
