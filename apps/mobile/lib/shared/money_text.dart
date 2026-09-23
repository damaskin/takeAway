import 'package:flutter/material.dart';

import '../core/format/money.dart';
import '../core/theme/tokens.dart';

extension MoneyContext on BuildContext {
  /// Formats minor units in the given currency for the current app locale.
  String money(int cents, String currency) =>
      Money.format(cents, currency, locale: Localizations.localeOf(this).languageCode);
}

/// A price that slides to its new value instead of jumping — used where the
/// amount reacts to the customer's choices (options, quantity, discounts).
class AnimatedMoney extends StatelessWidget {
  const AnimatedMoney({required this.cents, required this.currency, this.style, super.key});

  final int cents;
  final String currency;
  final TextStyle? style;

  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: Motion.medium,
      switchInCurve: Curves.easeOutCubic,
      switchOutCurve: Curves.easeInCubic,
      layoutBuilder: (current, previous) => Stack(alignment: Alignment.centerRight, children: [...previous, ?current]),
      transitionBuilder: (child, animation) => FadeTransition(
        opacity: animation,
        child: SlideTransition(
          position: Tween(begin: const Offset(0, 0.35), end: Offset.zero).animate(animation),
          child: child,
        ),
      ),
      child: Text(
        context.money(cents, currency),
        key: ValueKey('$currency$cents'),
        style: (style ?? const TextStyle()).copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
      ),
    );
  }
}
