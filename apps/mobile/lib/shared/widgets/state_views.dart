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
///
/// One snack at a time: a new one takes the place of the one on screen and
/// of anything still waiting, instead of queueing behind them — removing
/// three cart lines in a row used to leave three undo offers to sit through,
/// one after another.
///
/// An undo offer outranks the rest: while one is on screen, another notice
/// waits until it closes instead of taking it away — a foreground push or an
/// unrelated error used to take the "Undo" away before the customer could
/// reach it. Only the latest such notice waits.
abstract final class Snack {
  static const _short = Duration(seconds: 3);
  static const _withAction = Duration(seconds: 5);

  /// How long an undo offer stays once it has slid in: time enough to reach
  /// "Undo", without hanging over the screen after the customer has moved on.
  static const undoDuration = Duration(seconds: 3);

  static ScaffoldMessengerState? _undoMessenger;
  static ScaffoldFeatureController<SnackBar, SnackBarClosedReason>? _undo;

  /// The notice held back by the undo offer on screen.
  static SnackBar? _waiting;

  static bool _undoShowing(ScaffoldMessengerState messenger) =>
      _undo != null && identical(_undoMessenger, messenger) && messenger.mounted;

  static void show(
    BuildContext context,
    String message, {
    String? actionLabel,
    VoidCallback? onAction,
    IconData? icon,
  }) {
    final messenger = ScaffoldMessenger.maybeOf(context);
    if (messenger == null) return;
    final bar = _bar(
      context,
      message,
      icon: icon,
      actionLabel: actionLabel,
      onAction: onAction,
      duration: actionLabel == null ? _short : _withAction,
    );
    if (_undoShowing(messenger)) {
      _waiting = bar;
    } else {
      _replace(messenger, bar);
    }
  }

  /// Offers to take back what was just done. Shown at once (not after the
  /// server agrees), for [undoDuration], with a close button; it replaces any
  /// earlier offer.
  static void undo(
    BuildContext context,
    String message, {
    required String actionLabel,
    required VoidCallback onUndo,
    IconData? icon,
  }) {
    final messenger = ScaffoldMessenger.maybeOf(context);
    if (messenger == null) return;
    final controller = _replace(
      messenger,
      _bar(context, message, icon: icon, actionLabel: actionLabel, onAction: onUndo, duration: undoDuration),
    );
    _undo = controller;
    _undoMessenger = messenger;
    controller.closed.whenComplete(() {
      if (!identical(_undo, controller)) return;
      _undo = null;
      _undoMessenger = null;
      _showWaiting(messenger);
    });
  }

  /// Closes the undo offer, e.g. when the change it would undo failed.
  static void dismissUndo() {
    final messenger = _undoMessenger;
    _undo = null;
    _undoMessenger = null;
    if (messenger == null || !messenger.mounted) return;
    // Cleared rather than closed: the offer may still be waiting for the
    // snack before it to slide out, and only the one on screen can close.
    messenger.clearSnackBars();
    _showWaiting(messenger);
  }

  static void _showWaiting(ScaffoldMessengerState messenger) {
    final waiting = _waiting;
    _waiting = null;
    if (waiting != null && messenger.mounted) _replace(messenger, waiting);
  }

  /// Shows [bar] once the snack on screen has slid out; anything queued
  /// behind that one is dropped.
  static ScaffoldFeatureController<SnackBar, SnackBarClosedReason> _replace(
    ScaffoldMessengerState messenger,
    SnackBar bar,
  ) {
    messenger.clearSnackBars();
    return messenger.showSnackBar(bar);
  }

  static void error(BuildContext context, Object error) =>
      show(context, errorMessage(context, error), icon: Icons.error_outline_rounded);

  static SnackBar _bar(
    BuildContext context,
    String message, {
    required Duration duration,
    IconData? icon,
    String? actionLabel,
    VoidCallback? onAction,
  }) => SnackBar(
    content: Row(
      children: [
        if (icon != null) ...[Icon(icon, color: context.brand.caramel, size: 20), const SizedBox(width: 10)],
        Expanded(child: Text(message)),
      ],
    ),
    action: actionLabel == null ? null : SnackBarAction(label: actionLabel, onPressed: onAction ?? () {}),
    // A snack with an action would otherwise stay until something replaces
    // it; these all time out, and the close button dismisses one sooner.
    persist: false,
    showCloseIcon: actionLabel != null,
    duration: duration,
  );
}
