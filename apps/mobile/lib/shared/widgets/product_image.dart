import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';

import '../../core/theme/tokens.dart';

/// A product's photo, on a warm tinted backdrop while it loads or if it
/// fails to. Only for a product that has a photo ([isUsable]): one without
/// is laid out without an image at all — no stand-in art, which reads as
/// "image missing".
class ProductImage extends StatelessWidget {
  const ProductImage({required this.url, this.borderRadius, this.fit = BoxFit.cover, this.seed = '', super.key});

  final String? url;
  final BorderRadius? borderRadius;
  final BoxFit fit;

  /// Varies the backdrop tint so neighbouring photos that are still loading
  /// are not one flat block.
  final String seed;

  /// Whether [url] is a photo the app can load.
  static bool isUsable(String? url) => url != null && (url.startsWith('http://') || url.startsWith('https://'));

  @override
  Widget build(BuildContext context) {
    final image = isUsable(url)
        ? CachedNetworkImage(
            imageUrl: url!,
            fit: fit,
            fadeInDuration: Motion.medium,
            placeholder: (context, _) => _Backdrop(seed: seed),
            errorWidget: (context, _, _) => _Backdrop(seed: seed),
          )
        : _Backdrop(seed: seed);
    return ClipRRect(borderRadius: borderRadius ?? BorderRadius.zero, child: image);
  }
}

/// A plain tinted gradient, nothing drawn on it.
class _Backdrop extends StatelessWidget {
  const _Backdrop({required this.seed});

  final String seed;

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
          colors: [Color.alphaBlend(tint.withValues(alpha: 0.12), brand.latte), brand.cream],
        ),
      ),
      child: const SizedBox.expand(),
    );
  }
}
