import 'dart:math' as math;

import 'package:flutter/material.dart';

import '../../core/theme/tokens.dart';

/// The takeAway mark — the same takeaway cup as the launcher icon
/// (`tool/generate_icons.py`), drawn as vectors so it stays crisp and can
/// animate. [steam] (0..1) drives the steam wisps.
class CupLogo extends StatelessWidget {
  const CupLogo({this.size = 72, this.steam = 1, this.body, this.accent, super.key});

  final double size;
  final double steam;
  final Color? body;
  final Color? accent;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return CustomPaint(
      size: Size.square(size),
      painter: _CupPainter(
        body: body ?? brand.caramel,
        lid: Color.lerp(body ?? brand.caramel, Colors.black, 0.38)!,
        sleeve: accent ?? Color.lerp(brand.caramel, Colors.black, 0.55)!,
        steam: (body ?? brand.caramel).withValues(alpha: 0.55 * steam),
        steamPhase: steam,
      ),
    );
  }
}

/// A cup whose steam keeps rising — for splash-like and waiting states.
class AnimatedCupLogo extends StatefulWidget {
  const AnimatedCupLogo({this.size = 96, super.key});

  final double size;

  @override
  State<AnimatedCupLogo> createState() => _AnimatedCupLogoState();
}

class _AnimatedCupLogoState extends State<AnimatedCupLogo> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(
    vsync: this,
    duration: const Duration(milliseconds: 2400),
  )..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return AnimatedBuilder(
      animation: _controller,
      builder: (context, _) => CustomPaint(
        size: Size.square(widget.size),
        painter: _CupPainter(
          body: brand.caramel,
          lid: Color.lerp(brand.caramel, Colors.black, 0.38)!,
          sleeve: Color.lerp(brand.caramel, Colors.black, 0.55)!,
          steam: brand.caramel.withValues(alpha: 0.55),
          steamPhase: _controller.value,
          animateSteam: true,
        ),
      ),
    );
  }
}

class _CupPainter extends CustomPainter {
  _CupPainter({
    required this.body,
    required this.lid,
    required this.sleeve,
    required this.steam,
    required this.steamPhase,
    this.animateSteam = false,
  });

  final Color body;
  final Color lid;
  final Color sleeve;
  final Color steam;
  final double steamPhase;
  final bool animateSteam;

  @override
  void paint(Canvas canvas, Size size) {
    final s = size.width / 1024;
    Offset p(double x, double y) => Offset(x * s, y * s);
    Path poly(List<List<double>> pts) {
      final path = Path()..moveTo(pts.first[0] * s, pts.first[1] * s);
      for (final pt in pts.skip(1)) {
        path.lineTo(pt[0] * s, pt[1] * s);
      }
      return path..close();
    }

    RRect rrect(double x0, double y0, double x1, double y1, double r) =>
        RRect.fromRectAndRadius(Rect.fromPoints(p(x0, y0), p(x1, y1)), Radius.circular(r * s));

    // Steam.
    final steamPaint = Paint()
      ..color = steam
      ..style = PaintingStyle.stroke
      ..strokeCap = StrokeCap.round
      ..strokeWidth = 22 * s;
    for (final dx in [-62.0, 62.0]) {
      final path = Path();
      final shift = animateSteam ? steamPhase * 2 * math.pi + (dx > 0 ? math.pi / 2 : 0) : 0.0;
      for (var i = 0; i <= 40; i++) {
        final t = i / 40;
        final y = 206 - t * 104 - (animateSteam ? 10 * math.sin(steamPhase * math.pi) : 0);
        final x = 512 + dx + 16 * math.sin(t * 1.6 * math.pi + shift);
        if (i == 0) {
          path.moveTo(x * s, y * s);
        } else {
          path.lineTo(x * s, y * s);
        }
      }
      canvas.drawPath(path, steamPaint);
    }

    final fill = Paint()..color = body;
    canvas.drawPath(
      poly([
        [318, 330],
        [706, 330],
        [650, 800],
        [374, 800],
      ]),
      fill,
    );
    canvas.drawRRect(rrect(372, 772, 652, 812, 20), fill);
    canvas.drawPath(
      poly([
        [334, 480],
        [690, 480],
        [673, 628],
        [351, 628],
      ]),
      Paint()..color = sleeve,
    );
    final lidPaint = Paint()..color = lid;
    canvas.drawRRect(rrect(290, 280, 734, 338, 26), lidPaint);
    canvas.drawRRect(rrect(338, 236, 686, 292, 24), lidPaint);
  }

  @override
  bool shouldRepaint(_CupPainter old) =>
      old.steamPhase != steamPhase || old.body != body || old.sleeve != sleeve || old.steam != steam;
}
