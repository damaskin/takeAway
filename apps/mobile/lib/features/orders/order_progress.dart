import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/format/time.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/chips.dart';

/// Where an order sits on the Received → Preparing → Ready → Picked up
/// line, as a 0..1 fraction for the ring and an index for the stepper.
int orderStepIndex(OrderStatus status) => switch (status) {
  OrderStatus.created || OrderStatus.paid => 0,
  OrderStatus.accepted || OrderStatus.inProgress => 1,
  OrderStatus.ready => 2,
  OrderStatus.outForDelivery => 2,
  OrderStatus.pickedUp || OrderStatus.delivered => 3,
  _ => 0,
};

/// The big live dial: a countdown to the promised time while the kitchen
/// works, a pulse when the order is ready, a check when it is collected.
class OrderProgressRing extends StatefulWidget {
  const OrderProgressRing({required this.order, required this.now, this.size = 260, super.key});

  final Order order;
  final DateTime now;
  final double size;

  @override
  State<OrderProgressRing> createState() => _OrderProgressRingState();
}

class _OrderProgressRingState extends State<OrderProgressRing> with TickerProviderStateMixin {
  late final AnimationController _spin = AnimationController(vsync: this, duration: const Duration(seconds: 3))
    ..repeat();
  late final AnimationController _pulse = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 1400),
  );

  @override
  void initState() {
    super.initState();
    _syncPulse();
  }

  @override
  void didUpdateWidget(OrderProgressRing oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.order.status != widget.order.status) _syncPulse();
  }

  void _syncPulse() {
    if (widget.order.status == OrderStatus.ready) {
      _pulse.repeat(reverse: true);
    } else {
      _pulse
        ..stop()
        ..value = 0;
    }
  }

  @override
  void dispose() {
    _spin.dispose();
    _pulse.dispose();
    super.dispose();
  }

  /// Fraction of the wait already behind us, from order creation to pickup.
  double _elapsed() {
    final o = widget.order;
    final total = o.pickupAt.difference(o.createdAt).inMilliseconds;
    if (total <= 0) return 1;
    return (widget.now.difference(o.createdAt).inMilliseconds / total).clamp(0.0, 1.0);
  }

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final l10n = AppLocalizations.of(context);
    final order = widget.order;
    final status = order.status;
    final color = orderStatusColor(context, status);
    final done = status == OrderStatus.pickedUp || status == OrderStatus.delivered;
    final cancelled = status.isCancelled;
    final ready = status == OrderStatus.ready || status == OrderStatus.outForDelivery;

    final Widget center;
    if (cancelled) {
      center = Icon(Icons.close_rounded, size: widget.size * 0.3, color: brand.berry);
    } else if (done) {
      center = Icon(Icons.check_rounded, size: widget.size * 0.34, color: brand.mint);
    } else if (ready) {
      center = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(
            status == OrderStatus.outForDelivery ? Icons.delivery_dining_rounded : Icons.local_cafe_rounded,
            size: widget.size * 0.2,
            color: brand.mint,
          ),
          const SizedBox(height: 6),
          Text(l10n.readyShort, style: context.text.displaySmall?.copyWith(color: brand.mint)),
        ],
      );
    } else {
      final remaining = order.pickupAt.difference(widget.now);
      center = Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(
            formatCountdown(remaining),
            style: AppTheme.mono(
              size: widget.size * 0.2,
              weight: FontWeight.w700,
              color: brand.textPrimary,
              letterSpacing: -1,
            ),
          ),
          Text(l10n.untilReady, style: context.text.bodyMedium?.copyWith(color: brand.textSecondary)),
        ],
      );
    }

    return AnimatedBuilder(
      animation: Listenable.merge([_spin, _pulse]),
      builder: (context, child) => CustomPaint(
        size: Size.square(widget.size),
        painter: _RingPainter(
          track: brand.latte,
          color: color,
          progress: done || ready
              ? 1
              : cancelled
              ? 0
              : _elapsed(),
          sweep: !done && !ready && !cancelled ? _spin.value : null,
          glow: _pulse.value,
        ),
        child: child,
      ),
      child: SizedBox.square(
        dimension: widget.size,
        child: Center(
          child: AnimatedSwitcher(
            duration: Motion.slow,
            transitionBuilder: (child, animation) => ScaleTransition(
              scale: Tween(begin: 0.6, end: 1.0).animate(CurvedAnimation(parent: animation, curve: Curves.easeOutBack)),
              child: FadeTransition(opacity: animation, child: child),
            ),
            child: KeyedSubtree(key: ValueKey(status), child: center),
          ),
        ),
      ),
    );
  }
}

class _RingPainter extends CustomPainter {
  _RingPainter({
    required this.track,
    required this.color,
    required this.progress,
    required this.sweep,
    required this.glow,
  });

  final Color track;
  final Color color;
  final double progress;

  /// Rotating highlight while the kitchen works (0..1), null when idle.
  final double? sweep;
  final double glow;

  @override
  void paint(Canvas canvas, Size size) {
    final stroke = size.width * 0.055;
    final rect = Offset.zero & size;
    final inner = rect.deflate(stroke);

    if (glow > 0) {
      canvas.drawCircle(
        rect.center,
        size.width / 2 - stroke / 2,
        Paint()
          ..color = color.withValues(alpha: 0.18 * glow)
          ..maskFilter = MaskFilter.blur(BlurStyle.normal, size.width * 0.06 * glow),
      );
    }

    canvas.drawArc(
      inner,
      0,
      math.pi * 2,
      false,
      Paint()
        ..color = track
        ..style = PaintingStyle.stroke
        ..strokeWidth = stroke,
    );

    if (progress > 0) {
      canvas.drawArc(
        inner,
        -math.pi / 2,
        math.pi * 2 * progress,
        false,
        Paint()
          ..shader = SweepGradient(
            startAngle: -math.pi / 2,
            endAngle: -math.pi / 2 + math.pi * 2,
            colors: [color.withValues(alpha: 0.55), color],
            stops: [0, progress.clamp(0.01, 1)],
            transform: const GradientRotation(-math.pi / 2),
          ).createShader(inner)
          ..style = PaintingStyle.stroke
          ..strokeCap = StrokeCap.round
          ..strokeWidth = stroke,
      );
    }

    final s = sweep;
    if (s != null) {
      final angle = -math.pi / 2 + math.pi * 2 * s;
      final dot = Offset(
        inner.center.dx + inner.width / 2 * math.cos(angle),
        inner.center.dy + inner.height / 2 * math.sin(angle),
      );
      canvas.drawCircle(dot, stroke * 0.32, Paint()..color = color.withValues(alpha: 0.9));
    }
  }

  @override
  bool shouldRepaint(_RingPainter old) =>
      old.progress != progress || old.sweep != sweep || old.glow != glow || old.color != color || old.track != track;
}

/// Four labelled dots joined by a line that fills as the order advances.
class OrderStepper extends StatelessWidget {
  const OrderStepper({required this.status, required this.delivery, super.key});

  final OrderStatus status;
  final bool delivery;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final labels = [
      l10n.stepReceived,
      l10n.stepPreparing,
      delivery ? l10n.stepOnTheWay : l10n.stepReady,
      delivery ? l10n.stepDelivered : l10n.stepPickedUp,
    ];
    final current = orderStepIndex(status);
    final cancelled = status.isCancelled;

    return Row(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        for (var i = 0; i < labels.length; i++)
          Expanded(
            child: Column(
              children: [
                Row(
                  children: [
                    Expanded(
                      child: i == 0
                          ? const SizedBox.shrink()
                          : AnimatedContainer(
                              duration: Motion.slow,
                              height: 3,
                              color: !cancelled && i <= current ? brand.caramel : brand.latte,
                            ),
                    ),
                    AnimatedContainer(
                      duration: Motion.slow,
                      curve: Curves.easeOutBack,
                      width: i == current && !cancelled ? 22 : 16,
                      height: i == current && !cancelled ? 22 : 16,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: cancelled
                            ? brand.latte
                            : i <= current
                            ? brand.caramel
                            : brand.foam,
                        border: Border.all(color: !cancelled && i <= current ? brand.caramel : brand.border, width: 2),
                      ),
                      child: !cancelled && i < current
                          ? const Icon(Icons.check_rounded, size: 11, color: Colors.white)
                          : null,
                    ),
                    Expanded(
                      child: i == labels.length - 1
                          ? const SizedBox.shrink()
                          : AnimatedContainer(
                              duration: Motion.slow,
                              height: 3,
                              color: !cancelled && i < current ? brand.caramel : brand.latte,
                            ),
                    ),
                  ],
                ),
                const SizedBox(height: 6),
                Text(
                  labels[i],
                  textAlign: TextAlign.center,
                  style: context.text.labelSmall?.copyWith(
                    color: !cancelled && i <= current ? brand.textPrimary : brand.textTertiary,
                    fontWeight: i == current ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}
