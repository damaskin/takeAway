import 'package:flutter/material.dart';

import '../../core/theme/tokens.dart';

/// A card of [SettingsTile]s separated by hairlines, as on the profile and
/// about screens.
class SettingsGroup extends StatelessWidget {
  const SettingsGroup({required this.children, super.key});

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

class SettingsTile extends StatelessWidget {
  const SettingsTile({
    required this.icon,
    required this.title,
    required this.onTap,
    this.trailing,
    this.external = false,
    super.key,
  });

  final IconData icon;
  final String title;
  final VoidCallback onTap;
  final Widget? trailing;

  /// Opens a web page rather than a screen of the app.
  final bool external;

  @override
  Widget build(BuildContext context) {
    return ListTile(
      leading: Icon(icon),
      title: Text(title),
      trailing: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          ?trailing,
          Icon(
            external ? Icons.open_in_new_rounded : Icons.chevron_right_rounded,
            size: external ? 18 : null,
            color: context.brand.textTertiary,
          ),
        ],
      ),
      onTap: onTap,
    );
  }
}
