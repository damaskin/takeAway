import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../app/router.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/money_text.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/product_image.dart';
import '../../shared/widgets/state_views.dart';
import '../auth/sign_in_sheet.dart';
import '../cart/cart_controller.dart';
import '../catalog/catalog_providers.dart';

/// Hero tag shared by the menu card and the product screen.
String productHeroTag(String productId) => 'product-image-$productId';

/// Menu grid card: photo, name, price and a one-tap add.
class ProductCard extends ConsumerStatefulWidget {
  const ProductCard({required this.product, required this.store, super.key});

  final Product product;
  final Store store;

  @override
  ConsumerState<ProductCard> createState() => _ProductCardState();
}

class _ProductCardState extends ConsumerState<ProductCard> {
  bool _adding = false;

  void _open() => context.push(Routes.product(widget.product.id), extra: widget.product);

  /// Adds straight from the menu when there is nothing to choose; items with
  /// sizes or milks open the product screen instead, so nobody orders a
  /// latte without saying which one.
  Future<void> _quickAdd() async {
    if (_adding) return;
    if (!await ensureSignedIn(context, ref)) return;
    setState(() => _adding = true);
    try {
      final detail = await ref.read(productDetailProvider(widget.product.id).future);
      if (!mounted) return;
      if (detail.variations.isNotEmpty) {
        setState(() => _adding = false);
        _open();
        return;
      }
      await ref
          .read(cartProvider(widget.store.id).notifier)
          .add(
            productId: detail.id,
            modifiers: {
              for (final m in detail.modifiers)
                if (m.minCount > 0) m.id: m.minCount,
            },
          );
      // The cart bar acknowledges the add; see CartAddition.
      unawaited(HapticFeedback.mediumImpact());
    } on Object catch (error) {
      if (mounted) Snack.error(context, error);
    } finally {
      if (mounted) setState(() => _adding = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final l10n = AppLocalizations.of(context);
    final product = widget.product;
    final soldOut = product.onStopList;

    Widget image = Hero(
      tag: productHeroTag(product.id),
      child: ProductImage(url: product.imageUrl, seed: product.id),
    );
    if (soldOut) {
      image = ColorFiltered(colorFilter: const ColorFilter.matrix(_grayscale), child: image);
    }

    return Pressable(
      onTap: _open,
      semanticLabel: product.name,
      child: Container(
        decoration: BoxDecoration(
          color: brand.foam,
          borderRadius: BorderRadius.circular(Radii.card),
          border: Border.all(color: brand.borderLight),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            AspectRatio(
              aspectRatio: 1.05,
              child: Stack(
                fit: StackFit.expand,
                children: [
                  image,
                  if (soldOut)
                    Positioned(
                      left: 10,
                      top: 10,
                      child: Container(
                        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                        decoration: BoxDecoration(
                          color: brand.espresso.withValues(alpha: 0.8),
                          borderRadius: BorderRadius.circular(Radii.pill),
                        ),
                        child: Text(l10n.soldOut, style: context.text.labelSmall?.copyWith(color: brand.cream)),
                      ),
                    ),
                ],
              ),
            ),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(12, 10, 8, 10),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      product.name,
                      style: context.text.titleSmall?.copyWith(height: 1.25),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const Spacer(),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            context.money(product.basePriceCents, widget.store.currency),
                            style: context.text.titleMedium?.copyWith(
                              color: soldOut ? brand.textTertiary : brand.textPrimary,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                        ),
                        if (!soldOut) _AddButton(busy: _adding, onTap: _quickAdd, label: l10n.quickAdd),
                      ],
                    ),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _AddButton extends StatelessWidget {
  const _AddButton({required this.busy, required this.onTap, required this.label});

  final bool busy;
  final VoidCallback onTap;
  final String label;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return Semantics(
      button: true,
      label: label,
      child: Pressable(
        onTap: busy ? null : onTap,
        scale: 0.88,
        child: AnimatedContainer(
          duration: Motion.fast,
          width: 36,
          height: 36,
          decoration: BoxDecoration(color: brand.caramel, shape: BoxShape.circle),
          child: busy
              ? const Padding(
                  padding: EdgeInsets.all(9),
                  child: CircularProgressIndicator(strokeWidth: 2.2, color: Colors.white),
                )
              : const Icon(Icons.add_rounded, color: Colors.white, size: 22),
        ),
      ),
    );
  }
}

const _grayscale = <double>[
  0.2126, 0.7152, 0.0722, 0, 0, //
  0.2126, 0.7152, 0.0722, 0, 0,
  0.2126, 0.7152, 0.0722, 0, 0,
  0, 0, 0, 0.6, 0,
];
