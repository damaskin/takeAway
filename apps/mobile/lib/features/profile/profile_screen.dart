import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../app/router.dart';
import '../../core/providers.dart';
import '../../core/storage/app_prefs.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/cup_logo.dart';
import '../auth/auth_service.dart';
import '../auth/sign_in_sheet.dart';
import '../catalog/catalog_providers.dart';
import 'loyalty_widgets.dart';
import 'profile_providers.dart';

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
              _Group(
                children: [
                  _Tile(
                    icon: Icons.receipt_long_outlined,
                    title: l10n.ordersTitle,
                    onTap: () => context.go(Routes.orders),
                  ),
                  _Tile(
                    icon: Icons.badge_outlined,
                    title: l10n.profilePersonal,
                    onTap: () => context.push(Routes.personal),
                  ),
                  if (flags.agroprombankEnabled)
                    _Tile(
                      icon: Icons.credit_card_rounded,
                      title: l10n.profilePayment,
                      onTap: () => context.push(Routes.paymentMethods),
                    ),
                  _Tile(
                    icon: Icons.card_giftcard_rounded,
                    title: l10n.profileGiftCards,
                    onTap: () => context.push(Routes.giftCards),
                  ),
                  _Tile(
                    icon: Icons.group_add_outlined,
                    title: l10n.profileReferrals,
                    onTap: () => context.push(Routes.referrals),
                  ),
                  _Tile(
                    icon: Icons.notifications_none_rounded,
                    title: l10n.profileNotifications,
                    onTap: () => context.push(Routes.notifications),
                  ),
                ],
              ),
            ],
            const SizedBox(height: 16),
            _Group(
              children: [
                _Tile(
                  icon: Icons.translate_rounded,
                  title: l10n.profileLanguage,
                  trailing: Text(
                    _languageName(l10n, ref.watch(localeControllerProvider)),
                    style: context.text.bodySmall,
                  ),
                  onTap: () => showLanguagePicker(context, ref),
                ),
                _Tile(
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

class _Group extends StatelessWidget {
  const _Group({required this.children});

  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return Container(
      decoration: BoxDecoration(
        color: brand.foam,
        borderRadius: BorderRadius.circular(Radii.card),
        border: Border.all(color: brand.borderLight),
      ),
      clipBehavior: Clip.antiAlias,
      child: Column(
        children: [
          for (var i = 0; i < children.length; i++) ...[
            if (i > 0) Divider(indent: 56, color: brand.borderLight),
            children[i],
          ],
        ],
      ),
    );
  }
}

class _Tile extends StatelessWidget {
  const _Tile({required this.icon, required this.title, required this.onTap, this.trailing});

  final IconData icon;
  final String title;
  final VoidCallback onTap;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon),
      title: Text(title),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ?trailing,
          Icon(Icons.chevron_right_rounded, color: context.brand.textTertiary),
        ],
      ),
      onTap: onTap,
    );
  }
}
