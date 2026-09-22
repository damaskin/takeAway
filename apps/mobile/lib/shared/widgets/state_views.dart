import 'package:flutter/material.dart';

import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../error_message.dart';

/// Friendly empty state: a soft icon disc, a line of headline, a line of
/// help, and at most one way forward.
class EmptyState extends StatelessWidget {
  const EmptyState({
    required this.icon,
    required this.title,
    this.message,
    this.actionLabel,
    this.onAction,
    this.compact = false,
    super.key,
  });

  final IconData icon;
  final String title;
  final String? message;
  final String? actionLabel;
  final VoidCallback? onAction;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return Center(
      child: Padding(
        padding: EdgeInsets.symmetric(horizontal: 32, vertical: compact ? 16 : 40),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            TweenAnimationBuilder<double>(
              tween: Tween(begin: 0.85, end: 1),
              duration: Motion.slow,
              curve: Curves.easeOutBack,
              builder: (context, value, child) => Transform.scale(scale: value, child: child),
              child: Container(
                width: compact ? 72 : 96,
                height: compact ? 72 : 96,
                decoration: BoxDecoration(color: brand.caramelSoft, shape: BoxShape.circle),
                child: Icon(icon, size: compact ? 32 : 42, color: brand.caramel),
              ),
            ),
            const SizedBox(height: 20),
            Text(title, style: context.text.headlineSmall, textAlign: TextAlign.center),
            if (message != null) ...[
              const SizedBox(height: 8),
              Text(
                message!,
                style: context.text.bodyMedium?.copyWith(color: brand.textSecondary),
                textAlign: TextAlign.center,
              ),
            ],
            if (actionLabel != null && onAction != null) ...[
              const SizedBox(height: 24),
              FilledButton(
                onPressed: onAction,
                style: FilledButton.styleFrom(minimumSize: const Size(200, 50)),
                child: Text(actionLabel!),
              ),
            ],
          ],
        ),
      ),
    );
  }
}

class ErrorState extends StatelessWidget {
  const ErrorState({required this.error, this.onRetry, this.compact = false, super.key});

  final Object error;
  final VoidCallback? onRetry;
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    return EmptyState(
      icon: Icons.wifi_tethering_error_rounded,
      title: l10n.genericError,
      message: errorMessage(context, error),
      actionLabel: onRetry == null ? null : l10n.retry,
      onAction: onRetry,
      compact: compact,
    );
  }
}

/// Floating snack helpers with consistent styling.
abstract final class Snack {
  static void show(
    BuildContext context,
    String message, {
    String? actionLabel,
    VoidCallback? onAction,
    IconData? icon,
  }) {
    final messenger = ScaffoldMessenger.maybeOf(context);
    if (messenger == null) return;
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(
        SnackBar(
          content: Row(
            children: [
              if (icon != null) ...[Icon(icon, color: context.brand.caramel, size: 20), const SizedBox(width: 10)],
              Expanded(child: Text(message)),
            ],
          ),
          action: actionLabel == null ? null : SnackBarAction(label: actionLabel, onPressed: onAction ?? () {}),
          duration: const Duration(seconds: 3),
        ),
      );
  }

  static void error(BuildContext context, Object error) =>
      show(context, errorMessage(context, error), icon: Icons.error_outline_rounded);
}
