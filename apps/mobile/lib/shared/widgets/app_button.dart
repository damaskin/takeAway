import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/tokens.dart';

/// Primary call to action: full width, caramel, with an inline spinner while
/// [loading] so the label never jumps and double taps are impossible.
class PrimaryButton extends StatelessWidget {
  const PrimaryButton({
    required this.label,
    required this.onPressed,
    this.loading = false,
    this.icon,
    this.trailing,
    this.color,
    super.key,
  });

  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final IconData? icon;

  /// Right-aligned extra (e.g. a price) inside the button.
  final Widget? trailing;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    final enabled = onPressed != null && !loading;
    return FilledButton(
      onPressed: enabled
          ? () {
              HapticFeedback.lightImpact();
              onPressed!();
            }
          : null,
      style: color == null ? null : FilledButton.styleFrom(backgroundColor: color),
      child: AnimatedSwitcher(
        duration: Motion.fast,
        child: loading
            ? const SizedBox(
                key: ValueKey('spinner'),
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2.4, color: Colors.white),
              )
            : Row(
                key: const ValueKey('label'),
                mainAxisAlignment: trailing == null ? MainAxisAlignment.center : MainAxisAlignment.spaceBetween,
                children: [
                  Flexible(
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        if (icon != null) ...[Icon(icon, size: 20), const SizedBox(width: 8)],
                        Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
                      ],
                    ),
                  ),
                  ?trailing,
                ],
              ),
      ),
    );
  }
}

class SecondaryButton extends StatelessWidget {
  const SecondaryButton({required this.label, required this.onPressed, this.icon, this.danger = false, super.key});

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final bool danger;

  @override
  Widget build(BuildContext context) {
    final color = danger ? context.brand.berry : null;
    return OutlinedButton(
      onPressed: onPressed,
      style: color == null
          ? null
          : OutlinedButton.styleFrom(
              foregroundColor: color,
              side: BorderSide(color: color.withValues(alpha: 0.4)),
            ),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          if (icon != null) ...[Icon(icon, size: 20), const SizedBox(width: 8)],
          Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
        ],
      ),
    );
  }
}
