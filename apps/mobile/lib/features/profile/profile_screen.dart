import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../app/router.dart';
import '../../core/network/api_error.dart';
import '../../core/providers.dart';
import '../../core/storage/app_prefs.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/cup_logo.dart';
import '../../shared/widgets/state_views.dart';
import '../auth/auth_service.dart';
import '../auth/sign_in_sheet.dart';
import '../catalog/catalog_providers.dart';
import 'loyalty_widgets.dart';
import 'profile_providers.dart';
import 'settings_list.dart';

class ProfileScreen extends ConsumerWidget {
  const ProfileScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final user = ref.watch(currentUserProvider);
    final flags = ref.watch(featureFlagsProvider).valueOrNull ?? FeatureFlags.off;

    return Scaffold(
      appBar: AppBar(title: Text(l10n.profileTitle)),
      body: RefreshIndicator(
        color: context.brand.caramel,
        onRefresh: () async {
          if (user == null) return;
          ref.invalidate(loyaltyProvider);
          await ref.read(authServiceProvider).refreshProfile().catchError((Object _) => user);
        },
        child: ListView(
          padding: const EdgeInsets.fromLTRB(16, 4, 16, 32),
          children: [
            if (user == null)
              const _GuestCard()
            else ...[
              _UserHeader(user: user),
              const SizedBox(height: 16),
              const LoyaltyCardTile(),
              const SizedBox(height: 16),
              SettingsGroup(
                children: [
                  SettingsTile(
                    icon: Icons.receipt_long_outlined,
                    title: l10n.ordersTitle,
                    onTap: () => context.go(Routes.orders),
                  ),
                  SettingsTile(
                    icon: Icons.badge_outlined,
                    title: l10n.profilePersonal,
                    onTap: () => context.push(Routes.personal),
                  ),
                  // Only bound cards are managed here; on the bank's page
                  // the customer types the card each time.
                  if (flags.boundCardsEnabled)
                    SettingsTile(
                      icon: Icons.credit_card_rounded,
                      title: l10n.profilePayment,
                      onTap: () => context.push(Routes.paymentMethods),
                    ),
                  SettingsTile(
                    icon: Icons.card_giftcard_rounded,
                    title: l10n.profileGiftCards,
                    onTap: () => context.push(Routes.giftCards),
                  ),
                  SettingsTile(
                    icon: Icons.group_add_outlined,
                    title: l10n.profileReferrals,
                    onTap: () => context.push(Routes.referrals),
                  ),
                  SettingsTile(
                    icon: Icons.key_rounded,
                    title: l10n.signInMethodsTitle,
                    onTap: () => context.push(Routes.signInMethods),
                  ),
                  SettingsTile(
                    icon: Icons.notifications_none_rounded,
                    title: l10n.profileNotifications,
                    onTap: () => context.push(Routes.notifications),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 16),
            SettingsGroup(
              children: [
                SettingsTile(
                  icon: Icons.translate_rounded,
                  title: l10n.profileLanguage,
                  trailing: Text(
                    _languageName(l10n, ref.watch(localeControllerProvider)),
                    style: context.text.bodySmall,
                  ),
                  onTap: () => showLanguagePicker(context, ref),
                ),
                SettingsTile(
                  icon: Icons.info_outline_rounded,
                  title: l10n.profileAbout,
                  onTap: () => context.push(Routes.about),
                ),
              ],
            ),
            if (user != null) ...[
              const SizedBox(height: 16),
              SecondaryButton(
                label: l10n.signOut,
                icon: Icons.logout_rounded,
                danger: true,
                onPressed: () => _signOut(context, ref),
              ),
              const SizedBox(height: 8),
              const _DeleteAccountButton(),
            ],
          ],
        ),
      ),
    );
  }

  static String _languageName(AppLocalizations l10n, Locale? locale) => switch (locale?.languageCode) {
    'en' => l10n.languageEnglish,
    'ru' => l10n.languageRussian,
    _ => l10n.languageSystem,
  };

  Future<void> _signOut(BuildContext context, WidgetRef ref) async {
    final l10n = AppLocalizations.of(context);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.signOutConfirm),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l10n.cancel)),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(foregroundColor: context.brand.berry),
            child: Text(l10n.signOut),
          ),
        ],
      ),
    );
    if (ok == true) await ref.read(authServiceProvider).signOut();
  }
}

Future<void> showLanguagePicker(BuildContext context, WidgetRef ref) async {
  final l10n = AppLocalizations.of(context);
  final current = ref.read(localeControllerProvider)?.languageCode;
  final choice = await showModalBottomSheet<String>(
    context: context,
    builder: (context) => SafeArea(
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(l10n.languageTitle, style: context.text.headlineSmall),
          const SizedBox(height: 8),
          for (final (code, label) in [
            ('system', l10n.languageSystem),
            ('en', l10n.languageEnglish),
            ('ru', l10n.languageRussian),
          ])
            ListTile(
              title: Text(label),
              trailing: (current ?? 'system') == code ? Icon(Icons.check_rounded, color: context.brand.caramel) : null,
              onTap: () => Navigator.pop(context, code),
            ),
          const SizedBox(height: 8),
        ],
      ),
    ),
  );
  if (choice == null) return;
  final locale = choice == 'system' ? null : Locale(choice);
  await ref.read(localeControllerProvider.notifier).set(locale);
  // Keep the account's language in step, so pushes and receipts match.
  if (locale != null && ref.read(isSignedInProvider)) {
    unawaited(
      ref.read(authServiceProvider).updateProfile({'locale': choice.toUpperCase()}).catchError((Object _) {
        return ref.read(currentUserProvider)!;
      }),
    );
  }
}

/// Deletes the account from inside the app, as App Review requires of any
/// app that lets people create one (guideline 5.1.1(v)).
class _DeleteAccountButton extends ConsumerStatefulWidget {
  const _DeleteAccountButton();

  @override
  ConsumerState<_DeleteAccountButton> createState() => _DeleteAccountButtonState();
}

class _DeleteAccountButtonState extends ConsumerState<_DeleteAccountButton> {
  bool _busy = false;

  Future<void> _delete() async {
    if (_busy) return;
    final l10n = AppLocalizations.of(context);
    final auth = ref.read(authServiceProvider);
    setState(() => _busy = true);
    // Only for the wording: deleteAccount checks again and asks Apple itself.
    final withApple = await auth.deletionNeedsApple().catchError((Object _) => false);
    if (!mounted) return;
    setState(() => _busy = false);
    final ok = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: Text(l10n.deleteAccountTitle),
        content: Text(withApple ? '${l10n.deleteAccountBody}\n\n${l10n.deleteAccountApple}' : l10n.deleteAccountBody),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context, false), child: Text(l10n.cancel)),
          TextButton(
            onPressed: () => Navigator.pop(context, true),
            style: TextButton.styleFrom(
              backgroundColor: context.brand.berry,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(horizontal: 16),
            ),
            child: Text(l10n.deleteAccountConfirm),
          ),
        ],
      ),
    );
    if (ok != true || !mounted) return;
    // Once the session ends this screen turns into the guest card and this
    // button goes away, so take the router now.
    final router = GoRouter.of(context);
    setState(() => _busy = true);
    try {
      await auth.deleteAccount();
    } on SignInCancelled {
      if (!mounted) return;
      setState(() => _busy = false);
      Snack.show(context, l10n.deleteAccountAppleCancelled, icon: Icons.apple);
      return;
    } on Object catch (error) {
      if (!mounted) return;
      setState(() => _busy = false);
      if (ApiError.from(error).statusCode == 403) {
        Snack.show(context, l10n.deleteAccountStaff, icon: Icons.admin_panel_settings_outlined);
      } else {
        Snack.error(context, error);
      }
      return;
    }
    unawaited(HapticFeedback.mediumImpact());
    router.go(Routes.menu);
    final appContext = rootNavigatorKey.currentContext;
    if (appContext != null && appContext.mounted) {
      Snack.show(appContext, l10n.accountDeleted, icon: Icons.check_circle_outline_rounded);
    }
  }

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return TextButton.icon(
      onPressed: _busy ? null : _delete,
      style: TextButton.styleFrom(foregroundColor: brand.berry),
      icon: _busy
          ? SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2, color: brand.berry))
          : const Icon(Icons.delete_forever_outlined, size: 20),
      label: Text(AppLocalizations.of(context).deleteAccount),
    );
  }
}

class _GuestCard extends ConsumerWidget {
  const _GuestCard();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    return Container(
      padding: const EdgeInsets.all(24),
      decoration: BoxDecoration(
        color: brand.foam,
        borderRadius: BorderRadius.circular(Radii.card),
        border: Border.all(color: brand.borderLight),
      ),
      child: Column(
        children: [
          const CupLogo(size: 64),
          const SizedBox(height: 12),
          Text(l10n.profileGuestTitle, style: context.text.headlineSmall, textAlign: TextAlign.center),
          const SizedBox(height: 6),
          Text(
            l10n.profileGuestBody,
            style: context.text.bodyMedium?.copyWith(color: brand.textSecondary),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 18),
          PrimaryButton(label: l10n.signIn, onPressed: () => ensureSignedIn(context, ref)),
        ],
      ),
    );
  }
}

class _UserHeader extends StatelessWidget {
  const _UserHeader({required this.user});

  final AuthUser user;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final contact = user.email ?? user.phone;
    return Row(
      children: [
        Container(
          width: 64,
          height: 64,
          alignment: Alignment.center,
          decoration: BoxDecoration(
            shape: BoxShape.circle,
            gradient: LinearGradient(colors: [brand.caramel, Color.lerp(brand.caramel, brand.espresso, 0.4)!]),
          ),
          child: Text(user.initials, style: context.text.headlineSmall?.copyWith(color: Colors.white)),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                (user.name ?? '').isEmpty ? AppLocalizations.of(context).profileTitle : user.name!,
                style: context.text.headlineSmall,
              ),
              if (contact != null) Text(contact, style: context.text.bodySmall),
            ],
          ),
        ),
      ],
    );
  }
}
