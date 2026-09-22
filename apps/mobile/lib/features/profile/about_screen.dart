import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:package_info_plus/package_info_plus.dart';

import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/cup_logo.dart';

final _packageInfoProvider = FutureProvider<PackageInfo>((ref) => PackageInfo.fromPlatform());

class AboutScreen extends ConsumerWidget {
  const AboutScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final info = ref.watch(_packageInfoProvider).valueOrNull;
    return Scaffold(
      appBar: AppBar(title: Text(l10n.profileAbout)),
      body: Center(
        child: Padding(
          padding: const EdgeInsets.all(32),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const AnimatedCupLogo(size: 120),
              const SizedBox(height: 16),
              Text(l10n.appName, style: context.text.displaySmall),
              const SizedBox(height: 8),
              Text(l10n.tagline, style: context.text.titleMedium?.copyWith(color: context.brand.caramel)),
              const SizedBox(height: 16),
              Text(l10n.aboutBody, textAlign: TextAlign.center, style: context.text.bodyMedium),
              const SizedBox(height: 24),
              if (info != null)
                Text(l10n.appVersion('${info.version} (${info.buildNumber})'), style: context.text.bodySmall),
            ],
          ),
        ),
      ),
    );
  }
}
