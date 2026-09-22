import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../core/theme/tokens.dart';
import 'cup_logo.dart';

/// Product photo with a warm placeholder while it loads and a finished-
/// looking fallback when there is none (POS-imported items often have no
/// photo at all).
class ProductImage extends StatelessWidget {
  const ProductImage({this.url, this.borderRadius, this.fit = BoxFit.cover, this.seed = '', super.key});

  final String? url;
  final BorderRadius? borderRadius;
  final BoxFit fit;

  /// Varies the fallback tint so a grid of photo-less items is not uniform.
  final String seed;

  static bool isUsable(String? url) => url != null && (url.startsWith('http://') || url.startsWith('https://'));

  @override
  Widget build(BuildContext context) {
    final image = isUsable(url)
        ? CachedNetworkImage(
            imageUrl: url!,
            fit: fit,
            fadeInDuration: Motion.medium,
            placeholder: (context, _) => _Fallback(seed: seed, showMark: false),
            errorWidget: (context, _, _) => _Fallback(seed: seed),
          )
        : _Fallback(seed: seed);
    return ClipRRect(borderRadius: borderRadius ?? BorderRadius.zero, child: image);
  }
}

class _Fallback extends StatelessWidget {
  const _Fallback({required this.seed, this.showMark = true});

  final String seed;
  final bool showMark;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    const tints = [Palette.catCoffee, Palette.catTea, Palette.catBreakfast, Palette.catDesserts, Palette.catLunch];
    final tint = tints[seed.hashCode.abs() % tints.length];
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color.alphaBlend(tint.withValues(alpha: 0.16), brand.latte), brand.cream],
        ),
      ),
      child: showMark
          ? LayoutBuilder(
              builder: (context, box) => Center(
                child: Opacity(
                  opacity: 0.55,
                  child: CupLogo(size: (box.biggest.shortestSide * 0.5).clamp(24, 120).toDouble(), body: tint),
                ),
              ),
            )
          : const SizedBox.expand(),
    );
  }
}
