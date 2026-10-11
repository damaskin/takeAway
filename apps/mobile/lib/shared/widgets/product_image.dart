import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_svg/flutter_svg.dart';

import '../../core/theme/tokens.dart';
import '../product_kinds.dart';

/// Product photo with a warm placeholder while it loads and, when there is
/// none (POS-imported items often have no photo at all) or it fails, the
/// illustration for the product's [kind] — a paper cup, a clear cup, a
/// burger, a croissant or a takeaway bag — so the menu keeps one style.
class ProductImage extends StatelessWidget {
  const ProductImage({this.url, this.kind, this.borderRadius, this.fit = BoxFit.cover, this.seed = '', super.key});

  final String? url;

  /// Picks the illustration; null shows [ProductKind.other].
  final ProductKind? kind;
  final BorderRadius? borderRadius;
  final BoxFit fit;

  /// Varies the background tint so a grid of photo-less items is not uniform.
  final String seed;

  static bool isUsable(String? url) => url != null && (url.startsWith('http://') || url.startsWith('https://'));

  @override
  Widget build(BuildContext context) {
    final image = isUsable(url)
        ? CachedNetworkImage(
            imageUrl: url!,
            fit: fit,
            fadeInDuration: Motion.medium,
            placeholder: (context, _) => _Fallback(seed: seed),
            errorWidget: (context, _, _) => _Fallback(seed: seed, kind: kind ?? ProductKind.other),
          )
        : _Fallback(seed: seed, kind: kind ?? ProductKind.other);
    return ClipRRect(borderRadius: borderRadius ?? BorderRadius.zero, child: image);
  }
}

class _Fallback extends StatelessWidget {
  const _Fallback({required this.seed, this.kind});

  final String seed;

  /// The illustration to show; null while a photo is still loading.
  final ProductKind? kind;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    const tints = [Palette.catCoffee, Palette.catTea, Palette.catBreakfast, Palette.catDesserts, Palette.catLunch];
    final tint = tints[seed.hashCode.abs() % tints.length];
    final art = kind;
    return DecoratedBox(
      decoration: BoxDecoration(
        gradient: LinearGradient(
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
          colors: [Color.alphaBlend(tint.withValues(alpha: 0.12), brand.latte), brand.cream],
        ),
      ),
      child: art == null
          ? const SizedBox.expand()
          : LayoutBuilder(
              builder: (context, box) {
                // The art sits inside a 200×200 frame with its own margin.
                final side = (box.biggest.shortestSide * 0.86).clamp(24.0, 300.0);
                return Center(
                  child: SvgPicture.asset(
                    art.placeholderAsset,
                    key: ValueKey(art),
                    width: side,
                    height: side,
                    excludeFromSemantics: true,
                  ),
                );
              },
            ),
    );
  }
}
