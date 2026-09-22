import 'dart:math' as math;

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/storage/app_prefs.dart';
import '../../core/theme/app_theme.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/app_button.dart';
import '../../shared/widgets/cup_logo.dart';

/// Three-page introduction to pre-ordering, shown once on first launch.
class OnboardingScreen extends ConsumerStatefulWidget {
  const OnboardingScreen({super.key});

  @override
  ConsumerState<OnboardingScreen> createState() => _OnboardingScreenState();
}

class _OnboardingScreenState extends ConsumerState<OnboardingScreen> {
  final _pages = PageController();
  double _page = 0;

  @override
  void initState() {
    super.initState();
    _pages.addListener(() => setState(() => _page = _pages.page ?? 0));
  }

  @override
  void dispose() {
    _pages.dispose();
    super.dispose();
  }

  Future<void> _finish() async {
    await ref.read(onboardingDoneProvider.notifier).complete();
    if (mounted) context.go(Routes.menu);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final slides = [
      (l10n.onboardingTitle1, l10n.onboardingBody1, const _CupArt()),
      (l10n.onboardingTitle2, l10n.onboardingBody2, const _TimerArt()),
      (l10n.onboardingTitle3, l10n.onboardingBody3, const _CodeArt()),
    ];
    final last = _page.round() == slides.length - 1;

    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Align(
              alignment: Alignment.centerRight,
              child: AnimatedOpacity(
                opacity: last ? 0 : 1,
                duration: Motion.fast,
                child: TextButton(onPressed: last ? null : _finish, child: Text(l10n.onboardingSkip)),
              ),
            ),
            Expanded(
              child: PageView.builder(
                controller: _pages,
                itemCount: slides.length,
                onPageChanged: (_) => HapticFeedback.selectionClick(),
                itemBuilder: (context, index) {
                  final (title, body, art) = slides[index];
                  // Parallax: art drifts slower than the page, text fades.
                  final delta = (index - _page).clamp(-1.0, 1.0);
                  return Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 32),
                    child: Column(
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        Transform.translate(
                          offset: Offset(delta * 80, 0),
                          child: Transform.scale(scale: 1 - delta.abs() * 0.15, child: art),
                        ),
                        const SizedBox(height: 40),
                        Opacity(
                          opacity: (1 - delta.abs() * 1.4).clamp(0.0, 1.0),
                          child: Column(
                            children: [
                              Text(title, style: context.text.displaySmall, textAlign: TextAlign.center),
                              const SizedBox(height: 12),
                              Text(
                                body,
                                style: context.text.bodyLarge?.copyWith(color: brand.textSecondary),
                                textAlign: TextAlign.center,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  );
                },
              ),
            ),
            Row(
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                for (var i = 0; i < slides.length; i++)
                  AnimatedContainer(
                    duration: Motion.medium,
                    margin: const EdgeInsets.symmetric(horizontal: 4),
                    width: (_page - i).abs() < 0.5 ? 24 : 8,
                    height: 8,
                    decoration: BoxDecoration(
                      color: (_page - i).abs() < 0.5 ? brand.caramel : brand.border,
                      borderRadius: BorderRadius.circular(4),
                    ),
                  ),
              ],
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(24, 24, 24, 16),
              child: PrimaryButton(
                label: last ? l10n.onboardingStart : l10n.onboardingNext,
                icon: last ? Icons.local_cafe_rounded : null,
                onPressed: last ? _finish : () => _pages.nextPage(duration: Motion.slow, curve: Motion.emphasized),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _ArtDisc extends StatelessWidget {
  const _ArtDisc({required this.child});

  final Widget child;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return Container(
      width: 240,
      height: 240,
      decoration: BoxDecoration(
        shape: BoxShape.circle,
        gradient: RadialGradient(colors: [brand.caramelSoft, brand.cream]),
      ),
      child: Center(child: child),
    );
  }
}

class _CupArt extends StatelessWidget {
  const _CupArt();

  @override
  Widget build(BuildContext context) => const _ArtDisc(child: AnimatedCupLogo(size: 150));
}

class _TimerArt extends StatefulWidget {
  const _TimerArt();

  @override
  State<_TimerArt> createState() => _TimerArtState();
}

class _TimerArtState extends State<_TimerArt> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this, duration: const Duration(seconds: 4))
    ..repeat();

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return _ArtDisc(
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, _) {
          final t = _controller.value;
          final minutes = (7 - t * 7).ceil().clamp(1, 7);
          return Stack(
            alignment: Alignment.center,
            children: [
              SizedBox(
                width: 150,
                height: 150,
                child: CircularProgressIndicator(
                  value: t,
                  strokeWidth: 10,
                  strokeCap: StrokeCap.round,
                  color: brand.caramel,
                  backgroundColor: brand.latte,
                ),
              ),
              Text('$minutes:00', style: AppTheme.mono(size: 34, color: brand.textPrimary)),
            ],
          );
        },
      ),
    );
  }
}

class _CodeArt extends StatefulWidget {
  const _CodeArt();

  @override
  State<_CodeArt> createState() => _CodeArtState();
}

class _CodeArtState extends State<_CodeArt> with SingleTickerProviderStateMixin {
  late final AnimationController _controller = AnimationController(vsync: this, duration: const Duration(seconds: 2))
    ..repeat(reverse: true);

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return _ArtDisc(
      child: AnimatedBuilder(
        animation: _controller,
        builder: (context, child) =>
            Transform.rotate(angle: math.sin(_controller.value * math.pi) * 0.05, child: child),
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: 22, vertical: 18),
          decoration: BoxDecoration(
            color: brand.foam,
            borderRadius: BorderRadius.circular(Radii.card),
            border: Border.all(color: brand.caramel, width: 2),
            boxShadow: brand.liftedShadow,
          ),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Icon(Icons.qr_code_2_rounded, size: 56, color: brand.textPrimary),
              const SizedBox(height: 6),
              Text('4821', style: AppTheme.mono(size: 30, color: brand.caramel, letterSpacing: 6)),
            ],
          ),
        ),
      ),
    );
  }
}
