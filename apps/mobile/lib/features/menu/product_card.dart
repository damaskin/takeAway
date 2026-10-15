import 'package:flutter/material.dart';
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
import '../catalog/catalog_providers.dart';
import 'quick_add.dart';

/// Hero tag shared by the menu card and the product screen.
String productHeroTag(String productId) => 'product-image-$productId';

/// Whether [product] goes into the menu grid as a [ProductCard] — it has a
/// photo — or into the list under it as a [ProductRow].
bool hasMenuPhoto(Product product) => ProductImage.isUsable(product.imageUrl);

void _openProduct(BuildContext context, Product product) => context.push(Routes.product(product.id), extra: product);

/// Menu grid card for a product with a photo: photo, name, price and a
/// one-tap add.
class ProductCard extends StatelessWidget {
  const ProductCard({required this.product, required this.store, super.key});

  final Product product;
  final Store store;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final soldOut = product.onStopList;

    Widget image = Hero(
      tag: productHeroTag(product.id),
      child: ProductImage(url: product.imageUrl, seed: product.id),
    );
    if (soldOut) {
      image = ColorFiltered(colorFilter: const ColorFilter.matrix(_grayscale), child: image);
    }

    return Pressable(
      onTap: () => _openProduct(context, product),
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
                  if (soldOut) const Positioned(left: 10, top: 10, child: _SoldOutBadge()),
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
                          child: _Price(product: product, store: store),
                        ),
                        MenuAddButton(product: product, store: store),
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

/// Menu row for a product without a photo, listed under its category's
/// grid: name, a line or two of description, price and the same one-tap
/// add. Text only, by design — a stand-in picture would read as a photo that
/// failed to load.
class ProductRow extends StatelessWidget {
  const ProductRow({required this.product, required this.store, super.key});

  final Product product;
  final Store store;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final soldOut = product.onStopList;
    final description = product.description?.trim() ?? '';

    return Pressable(
      onTap: () => _openProduct(context, product),
      semanticLabel: product.name,
      child: Container(
        padding: const EdgeInsets.fromLTRB(16, 14, 12, 14),
        decoration: BoxDecoration(
          color: brand.foam,
          borderRadius: BorderRadius.circular(Radii.card),
          border: Border.all(color: brand.borderLight),
        ),
        child: Row(
          children: [
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    product.name,
                    style: context.text.titleSmall?.copyWith(
                      height: 1.25,
                      color: soldOut ? brand.textSecondary : brand.textPrimary,
                    ),
                    maxLines: 2,
                    overflow: TextOverflow.ellipsis,
                  ),
                  if (description.isNotEmpty) ...[
                    const SizedBox(height: 3),
                    Text(
                      description,
                      style: context.text.bodySmall?.copyWith(color: brand.textSecondary),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ],
                  const SizedBox(height: 6),
                  _Price(product: product, store: store),
                ],
              ),
            ),
            const SizedBox(width: 12),
            if (soldOut) const _SoldOutBadge() else MenuAddButton(product: product, store: store),
          ],
        ),
      ),
    );
  }
}

class _Price extends StatelessWidget {
  const _Price({required this.product, required this.store});

  final Product product;
  final Store store;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return Text(
      context.money(product.basePriceCents, store.currency),
      style: context.text.titleMedium?.copyWith(
        color: product.onStopList ? brand.textTertiary : brand.textPrimary,
        fontWeight: FontWeight.w700,
      ),
    );
  }
}

class _SoldOutBadge extends StatelessWidget {
  const _SoldOutBadge();

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
      decoration: BoxDecoration(
        color: brand.espresso.withValues(alpha: 0.8),
        borderRadius: BorderRadius.circular(Radii.pill),
      ),
      child: Text(AppLocalizations.of(context).soldOut, style: context.text.labelSmall?.copyWith(color: brand.cream)),
    );
  }
}

/// The menu's «+». Adds straight from the menu when there is nothing to
/// choose (see [quickAdd]); the cart bar acknowledges it, see CartAddition.
/// Nothing to tap while the product is sold out or the store is closed.
class MenuAddButton extends ConsumerStatefulWidget {
  const MenuAddButton({required this.product, required this.store, super.key});

  final Product product;
  final Store store;

  @override
  ConsumerState<MenuAddButton> createState() => _MenuAddButtonState();
}

class _MenuAddButtonState extends ConsumerState<MenuAddButton> {
  bool _busy = false;

  Future<void> _add() async {
    if (_busy) return;
    try {
      await quickAdd(context, ref, widget.product, widget.store, onBusy: () => setState(() => _busy = true));
    } on Object catch (error) {
      if (mounted) Snack.error(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final storeOpen = (ref.watch(liveStoreProvider(widget.store.id)) ?? widget.store).takesOrders;
    if (widget.product.onStopList || !storeOpen) return const SizedBox.shrink();
    final brand = context.brand;
    return Semantics(
      button: true,
      label: AppLocalizations.of(context).quickAdd,
      child: Pressable(
        onTap: _busy ? null : _add,
        scale: 0.88,
        child: AnimatedContainer(
          duration: Motion.fast,
          width: 36,
          height: 36,
          decoration: BoxDecoration(color: brand.caramel, shape: BoxShape.circle),
          child: _busy
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
