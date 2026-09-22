import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import '../../core/theme/tokens.dart';

/// − n + stepper. The count animates vertically in the direction of change.
class QuantityStepper extends StatefulWidget {
  const QuantityStepper({
    required this.value,
    required this.onChanged,
    this.min = 0,
    this.max = 99,
    this.compact = false,
    this.decrementIcon,
    super.key,
  });

  final int value;
  final ValueChanged<int> onChanged;
  final int min;
  final int max;
  final bool compact;

  /// Replaces the minus sign — e.g. a bin when going below one removes.
  final IconData? decrementIcon;

  @override
  State<QuantityStepper> createState() => _QuantityStepperState();
}

class _QuantityStepperState extends State<QuantityStepper> {
  int _direction = 1;

  void _change(int delta) {
    final next = widget.value + delta;
    if (next < widget.min || next > widget.max) return;
    HapticFeedback.selectionClick();
    setState(() => _direction = delta.sign);
    widget.onChanged(next);
  }

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final size = widget.compact ? 32.0 : 40.0;
    Widget button(IconData icon, VoidCallback? onTap, String label) => Semantics(
      button: true,
      label: label,
      child: InkResponse(
        onTap: onTap,
        radius: size * 0.6,
        child: SizedBox(
          width: size,
          height: size,
          child: Icon(
            icon,
            size: widget.compact ? 18 : 20,
            color: onTap == null ? brand.textTertiary : brand.textPrimary,
          ),
        ),
      ),
    );

    return Container(
      decoration: BoxDecoration(
        color: brand.foam,
        borderRadius: BorderRadius.circular(Radii.pill),
        border: Border.all(color: brand.border),
      ),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          button(
            widget.decrementIcon ?? Icons.remove_rounded,
            widget.value > widget.min ? () => _change(-1) : null,
            '−',
          ),
          SizedBox(
            width: widget.compact ? 22 : 28,
            child: AnimatedSwitcher(
              duration: Motion.fast,
              transitionBuilder: (child, animation) {
                final incoming = child.key == ValueKey(widget.value);
                final begin = Offset(0, (incoming ? 0.6 : -0.6) * _direction);
                return ClipRect(
                  child: SlideTransition(
                    position: Tween(begin: begin, end: Offset.zero).animate(animation),
                    child: FadeTransition(opacity: animation, child: child),
                  ),
                );
              },
              child: Text(
                '${widget.value}',
                key: ValueKey(widget.value),
                textAlign: TextAlign.center,
                style: context.text.titleSmall?.copyWith(fontFeatures: const [FontFeature.tabularFigures()]),
              ),
            ),
          ),
          button(Icons.add_rounded, widget.value < widget.max ? () => _change(1) : null, '+'),
        ],
      ),
    );
  }
}
