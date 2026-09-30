import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/web_pages.dart';
import '../../shared/widgets/cup_logo.dart';
import 'settings_list.dart';

final _packageInfoProvider = FutureProvider<PackageInfo>((ref) => PackageInfo.fromPlatform());

class AboutScreen extends ConsumerWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final info = ref.watch(_packageInfoProvider).valueOrNull;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.profileAbout)),
      body: ListView(
        padding: const EdgeInsets.fromLTRB(16, 24, 16, 32),
        children: [
          const Center(child: AnimatedCupLogo(size: 120)),
          const SizedBox(height: 16),
          Text(l10n.appName, style: context.text.displaySmall, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          Text(
            l10n.tagline,
            style: context.text.titleMedium?.copyWith(color: context.brand.caramel),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: 16),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            child: Text(l10n.aboutBody, textAlign: TextAlign.center, style: context.text.bodyMedium),
          ),
          const SizedBox(height: 24),
          SettingsGroup(
            children: [
              SettingsTile(
                icon: Icons.privacy_tip_outlined,
                title: l10n.aboutPrivacy,
                external: true,
                onTap: () => unawaited(openWebPage(WebPages.privacy)),
              ),
              SettingsTile(
                icon: Icons.description_outlined,
                title: l10n.aboutTerms,
                external: true,
                onTap: () => unawaited(openWebPage(WebPages.terms)),
              ),
              SettingsTile(
                icon: Icons.support_agent_rounded,
                title: l10n.aboutSupport,
                external: true,
                onTap: () => unawaited(openWebPage(WebPages.support)),
              ),
            ],
          ),
          const SizedBox(height: 24),
          if (info != null)
            Text(
              l10n.appVersion('${info.version} (${info.buildNumber})'),
              style: context.text.bodySmall,
              textAlign: TextAlign.center,
            ),
        ],
      ),
    );
  }
}
