import 'dart:async';

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
import '../menu/quick_add.dart';
import 'upsell.dart';

/// The cart's «Добавить к напитку?»: when it holds a drink and nothing to
/// eat, a row of the store's bakery and food. Gone once something to eat is
/// in the cart, or when there is nothing to offer.
class CartUpsell extends ConsumerWidget {
  const CartUpsell({required this.store, required this.cart, super.key});

  final Store store;
  final Cart cart;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final menu = ref.watch(menuProvider(store.id)).valueOrNull?.value;
    final items = menu == null || !store.isOpen || !wantsFood(cart, menu)
        ? const <Suggestion>[]
        : foodSuggestions(menu, exclude: {for (final item in cart.items) item.productId});
    return AnimatedSize(
      duration: Motion.medium,
      curve: Motion.emphasized,
      alignment: Alignment.topCenter,
      child: items.isEmpty
          ? const SizedBox(width: double.infinity)
          : Padding(
              padding: const EdgeInsets.only(top: 4, bottom: 20),
              child: UpsellRow(title: AppLocalizations.of(context).cartUpsellTitle, items: items, store: store),
            ),
    );
  }
}

/// A titled horizontal row of products to add — the cart's «Добавить к
/// напитку?», the drink screen's «К этому напитку». A card opens the
/// product; its «+» adds it at once, or opens it when there is something to
/// choose (see [quickAdd]).
class UpsellRow extends StatelessWidget {
  const UpsellRow({required this.title, required this.items, required this.store, this.onAdded, super.key});

  final String title;
  final List<Suggestion> items;
  final Store store;

  /// Called after a «+» put a product in the cart.
  final ValueChanged<Product>? onAdded;

  static const cardWidth = 136.0;
  static const _imageHeight = 100.0;

  @override
  Widget build(BuildContext context) {
    final scaler = MediaQuery.textScalerOf(context);
    // Room for the photo, two lines of name at the customer's text size and
    // the price row with its 44-point «+». A row with no photos at all is
    // text cards only: the name and, when there is one, a two-line
    // description instead of the photo.
    final anyPhoto = items.any((s) => ProductImage.isUsable(s.product.imageUrl));
    final anyDescription = items.any((s) => (s.product.description?.trim() ?? '').isNotEmpty);
    final height = anyPhoto
        ? _imageHeight + 8 + scaler.scale(38) + 50
        : 12 + scaler.scale(38) + (anyDescription ? 4 + scaler.scale(32) : 0) + 50;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Semantics(header: true, child: Text(title, style: context.text.titleMedium)),
        const SizedBox(height: 10),
        SizedBox(
          height: height,
          child: ListView.separated(
            scrollDirection: Axis.horizontal,
            clipBehavior: Clip.none,
            itemCount: items.length,
            separatorBuilder: (_, _) => const SizedBox(width: 10),
            itemBuilder: (context, index) => _UpsellCard(
              key: ValueKey(items[index].product.id),
              suggestion: items[index],
              store: store,
              onAdded: onAdded,
            ),
          ),
        ),
      ],
    );
  }
}

class _UpsellCard extends ConsumerStatefulWidget {
  const _UpsellCard({required this.suggestion, required this.store, this.onAdded, super.key});

  final Suggestion suggestion;
  final Store store;
  final ValueChanged<Product>? onAdded;

  @override
  ConsumerState<_UpsellCard> createState() => _UpsellCardState();
}

class _UpsellCardState extends ConsumerState<_UpsellCard> {
  bool _busy = false;
  bool _done = false;
  Timer? _doneTimer;

  @override
  void dispose() {
    _doneTimer?.cancel();
    super.dispose();
  }

  Product get _product => widget.suggestion.product;

  void _open() => context.push(Routes.product(_product.id), extra: _product);

  Future<void> _add() async {
    if (_busy) return;
    try {
      final result = await quickAdd(context, ref, _product, widget.store, onBusy: () => setState(() => _busy = true));
      if (result != QuickAddResult.added || !mounted) return;
      setState(() => _done = true);
      _doneTimer?.cancel();
      _doneTimer = Timer(const Duration(milliseconds: 1600), () {
        if (mounted) setState(() => _done = false);
      });
      widget.onAdded?.call(_product);
    } on Object catch (error) {
      if (mounted) Snack.error(context, error);
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final l10n = AppLocalizations.of(context);
    final product = _product;
    // Without a photo the card is text only: the name, then as much of the
    // description as the card has room for.
    final photo = ProductImage.isUsable(product.imageUrl);
    final description = photo ? '' : product.description?.trim() ?? '';
    final descriptionStyle = context.text.bodySmall?.copyWith(color: brand.textSecondary);

    return Pressable(
      onTap: _open,
      semanticLabel: product.name,
      child: Container(
        width: UpsellRow.cardWidth,
        decoration: BoxDecoration(
          color: brand.foam,
          borderRadius: BorderRadius.circular(16),
          border: Border.all(color: brand.borderLight),
        ),
        clipBehavior: Clip.antiAlias,
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            if (photo)
              SizedBox(
                height: UpsellRow._imageHeight,
                child: ProductImage(url: product.imageUrl, seed: product.id),
              ),
            Expanded(
              child: Padding(
                padding: EdgeInsets.fromLTRB(10, photo ? 8 : 12, 2, 2),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      product.name,
                      style: context.text.titleSmall?.copyWith(height: 1.2),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    if (description.isEmpty)
                      const Spacer()
                    else
                      Expanded(
                        child: Padding(
                          padding: const EdgeInsets.only(top: 4, right: 8),
                          child: LayoutBuilder(
                            builder: (context, box) {
                              final line = MediaQuery.textScalerOf(
                                context,
                              ).scale((descriptionStyle?.fontSize ?? 12) * (descriptionStyle?.height ?? 1.35));
                              final lines = (box.maxHeight / line).floor();
                              if (lines < 1) return const SizedBox.shrink();
                              return Text(
                                description,
                                style: descriptionStyle,
                                maxLines: lines,
                                overflow: TextOverflow.ellipsis,
                              );
                            },
                          ),
                        ),
                      ),
                    Row(
                      children: [
                        Expanded(
                          child: Text(
                            context.money(product.basePriceCents, widget.store.currency),
                            style: context.text.titleSmall?.copyWith(fontWeight: FontWeight.w700),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                        _PlusButton(busy: _busy, done: _done, label: '${l10n.quickAdd}: ${product.name}', onTap: _add),
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

/// The card's «+»: a 32-point disc in a 44-point tap target; a tick for a
/// moment once the product is in the cart.
class _PlusButton extends StatelessWidget {
  const _PlusButton({required this.busy, required this.done, required this.label, required this.onTap});

  final bool busy;
  final bool done;
  final String label;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    return Semantics(
      button: true,
      label: label,
      excludeSemantics: true,
      onTap: busy ? null : onTap,
      child: Pressable(
        onTap: busy ? null : onTap,
        scale: 0.88,
        child: SizedBox.square(
          dimension: 44,
          child: Center(
            child: AnimatedContainer(
              duration: Motion.fast,
              width: 32,
              height: 32,
              decoration: BoxDecoration(color: done ? brand.mint : brand.caramel, shape: BoxShape.circle),
              child: busy
                  ? const Padding(
                      padding: EdgeInsets.all(8),
                      child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                    )
                  : Icon(done ? Icons.check_rounded : Icons.add_rounded, color: Colors.white, size: 20),
            ),
          ),
        ),
      ),
    );
  }
}
