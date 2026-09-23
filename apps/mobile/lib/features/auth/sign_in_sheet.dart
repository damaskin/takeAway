import 'dart:async';

import 'dart:io';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/error_message.dart';
import '../../shared/widgets/cup_logo.dart';
import 'auth_service.dart';

/// Opens the sign-in sheet; completes with true once the customer is in.
/// Call sites resume what the customer was doing (adding to cart,
/// checking out) instead of dropping them on a login page.
Future<bool> ensureSignedIn(BuildContext context, WidgetRef ref) async {
  if (ref.read(isSignedInProvider)) return true;
  final result = await showModalBottomSheet<bool>(
    context: context,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (_) => const SignInSheet(),
  );
  return result ?? ref.read(isSignedInProvider);
}

enum _Provider { telegram, google, apple, dev }

class SignInSheet extends ConsumerStatefulWidget {
  const SignInSheet({super.key});

  @override
  ConsumerState<SignInSheet> createState() => _SignInSheetState();
}

class _SignInSheetState extends ConsumerState<SignInSheet> {
  _Provider? _busy;
  String? _error;

  Future<void> _run(_Provider provider) async {
    if (_busy != null) return;
    setState(() {
      _busy = provider;
      _error = null;
    });
    final auth = ref.read(authServiceProvider);
    try {
      switch (provider) {
        case _Provider.telegram:
          await auth.signInWithTelegram();
        case _Provider.google:
          await auth.signInWithGoogle();
        case _Provider.apple:
          await auth.signInWithApple();
        case _Provider.dev:
          await auth.devSignIn();
      }
      unawaited(HapticFeedback.mediumImpact());
      if (mounted) Navigator.of(context).pop(true);
    } on SignInCancelled {
      if (mounted) setState(() => _busy = null);
    } on Object catch (error) {
      if (!mounted) return;
      setState(() {
        _busy = null;
        _error = error is PlatformException || error is StateError
            ? AppLocalizations.of(context).signInFailed
            : errorMessage(context, error);
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final options = ref.watch(signInOptionsProvider);

    return Padding(
      padding: EdgeInsets.fromLTRB(24, 0, 24, 24 + MediaQuery.viewInsetsOf(context).bottom),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          const Center(child: CupLogo()),
          const SizedBox(height: 16),
          Text(l10n.signInTitle, style: context.text.headlineMedium, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text(
            l10n.signInSubtitle,
            style: context.text.bodyMedium?.copyWith(color: brand.textSecondary),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 24),
          options.when(
            loading: () => const Padding(
              padding: EdgeInsets.all(24),
              child: Center(child: CircularProgressIndicator()),
            ),
            error: (_, _) => Text(l10n.signInUnavailable, textAlign: TextAlign.center),
            data: (o) => Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                if (!o.any)
                  Text(
                    l10n.signInUnavailable,
                    textAlign: TextAlign.center,
                    style: context.text.bodyMedium?.copyWith(color: brand.textSecondary),
                  ),
                if (o.telegram)
                  _ProviderButton(
                    label: l10n.continueWithTelegram,
                    icon: Icons.send_rounded,
                    background: const Color(0xFF2AABEE),
                    foreground: Colors.white,
                    busy: _busy == _Provider.telegram,
                    onTap: () => _run(_Provider.telegram),
                  ),
                if (o.apple && Platform.isIOS)
                  _ProviderButton(
                    label: l10n.continueWithApple,
                    icon: Icons.apple,
                    background: brand.espresso,
                    foreground: brand.cream,
                    busy: _busy == _Provider.apple,
                    onTap: () => _run(_Provider.apple),
                  ),
                if (o.google)
                  _ProviderButton(
                    label: l10n.continueWithGoogle,
                    icon: Icons.g_mobiledata_rounded,
                    background: brand.foam,
                    foreground: brand.textPrimary,
                    outlined: true,
                    busy: _busy == _Provider.google,
                    onTap: () => _run(_Provider.google),
                  ),
                if (o.dev)
                  _ProviderButton(
                    label: l10n.devSignIn,
                    icon: Icons.developer_mode_rounded,
                    background: brand.latte,
                    foreground: brand.textPrimary,
                    busy: _busy == _Provider.dev,
                    onTap: () => _run(_Provider.dev),
                  ),
              ],
            ),
          ),
          AnimatedSize(
            duration: Motion.medium,
            child: _error == null
                ? const SizedBox(width: double.infinity)
                : Padding(
                    padding: const EdgeInsets.only(top: 12),
                    child: Text(
                      _error!,
                      textAlign: TextAlign.center,
                      style: context.text.bodyMedium?.copyWith(color: brand.berry),
                    ),
                  ),
          ),
          const SizedBox(height: 16),
          Text(
            l10n.signInAgreement,
            textAlign: TextAlign.center,
            style: context.text.bodySmall?.copyWith(color: brand.textTertiary),
          ),
        ],
      ),
    );
  }
}

class _ProviderButton extends StatelessWidget {
  const _ProviderButton({
    required this.label,
    required this.icon,
    required this.background,
    required this.foreground,
    required this.busy,
    required this.onTap,
    this.outlined = false,
  });

  final String label;
  final IconData icon;
  final Color background;
  final Color foreground;
  final bool busy;
  final bool outlined;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 12),
      child: FilledButton(
        onPressed: busy ? null : onTap,
        style: FilledButton.styleFrom(
          backgroundColor: background,
          foregroundColor: foreground,
          disabledBackgroundColor: background.withValues(alpha: 0.7),
          disabledForegroundColor: foreground,
          side: outlined ? BorderSide(color: context.brand.border) : null,
        ),
        child: busy
            ? SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.4, color: foreground))
            : Row(
                mainAxisAlignment: MainAxisAlignment.center,
                children: [
                  Icon(icon, size: 22),
                  const SizedBox(width: 10),
                  Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
                ],
              ),
      ),
    );
  }
}
