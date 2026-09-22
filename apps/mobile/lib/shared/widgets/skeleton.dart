import 'package:flutter/material.dart';

import '../../core/theme/tokens.dart';

/// Shimmering placeholder. One [ShimmerScope] animates every [Skeleton]
/// below it in sync, which reads as a single surface loading rather than a
/// field of blinking boxes.
class ShimmerScope extends StatefulWidget {
  const ShimmerScope({required this.child, super.key});

  final Widget child;

  static Animation<double>? of(BuildContext context) =>
      context.dependOnInheritedWidgetOfExactType<_ShimmerInherited>()?.animation;

  @override
  State<ShimmerScope> createState() => _ShimmerScopeState();
}

class _ShimmerScopeState extends State<ShimmerScope> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => _ShimmerInherited(animation: _controller, child: widget.child);
}

class _ShimmerInherited extends InheritedWidget {
  const _ShimmerInherited({required this.animation, required super.child});

  final Animation<double> animation;

  @override
  bool updateShouldNotify(_ShimmerInherited oldWidget) => animation != oldWidget.animation;
}

class Skeleton extends StatelessWidget {
  const Skeleton({this.width, this.height = 14, this.radius = 8, super.key});

  const Skeleton.circle({required double size, super.key}) : width = size, height = size, radius = size / 2;

  final double? width;
  final double height;
  final double radius;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final animation = ShimmerScope.of(context);
    final base = brand.latte.withValues(alpha: 0.7);
    final highlight = brand.foam;

    Widget box(double t) => Container(
      width: width,
      height: height,
      decoration: BoxDecoration(
        borderRadius: BorderRadius.circular(radius),
        gradient: LinearGradient(
          begin: Alignment(-1.5 + 3 * t, -0.3),
          end: Alignment(-0.5 + 3 * t, 0.3),
          colors: [base, highlight, base],
          stops: const [0.2, 0.5, 0.8],
        ),
      ),
    );

    if (animation == null) return box(0);
    return AnimatedBuilder(animation: animation, builder: (context, _) => box(animation.value));
  }
}
