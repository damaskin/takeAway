import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/theme/tokens.dart';
import '../../shared/money_text.dart';
import '../../shared/widgets/product_image.dart';
import '../../shared/widgets/quantity_stepper.dart';
import '../catalog/catalog_providers.dart';

/// Human summary of a cart line's options — "Large · Oat milk · 2× Shot".
/// Names come from the product details (the cart only stores ids), so the
/// line renders with just the product name until they arrive.
String optionsSummary(ProductDetail? product, List<String> variationIds, Map<String, int> modifiers) {
  if (product == null) return '';
  final parts = <String>[
    for (final v in product.variations)
      if (variationIds.contains(v.id)) v.name,
    for (final m in product.modifiers)
      if ((modifiers[m.id] ?? 0) > 0) (modifiers[m.id]! > 1 ? '${modifiers[m.id]}× ${m.name}' : m.name),
  ];
  return parts.join(' · ');
}

/// Photo for a product id, looked up in the store's loaded menu.
String? menuImageFor(WidgetRef ref, String storeId, String productId) {
  final menu = ref.watch(menuProvider(storeId)).valueOrNull?.value;
  if (menu == null) return null;
  for (final product in menu.allProducts) {
    if (product.id == productId) return product.imageUrl;
  }
  return null;
}

class CartLine extends ConsumerWidget {
  const CartLine({
    required this.item,
    required this.storeId,
    required this.currency,
    required this.onQuantity,
    super.key,
  });

  final CartItem item;
  final String storeId;
  final String currency;
  final ValueChanged<int> onQuantity;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final brand = context.brand;
    final detail = ref.watch(productDetailProvider(item.productId)).valueOrNull;
    final options = optionsSummary(detail, item.variationIds, item.modifiers);
    final image = menuImageFor(ref, storeId, item.productId) ?? detail?.imageUrl;

    return Container(
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: brand.foam,
        borderRadius: BorderRadius.circular(Radii.card),
        border: Border.all(color: brand.borderLight),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          SizedBox(
            width: 72,
            height: 72,
            child: ProductImage(url: image, seed: item.productId, borderRadius: BorderRadius.circular(16)),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(item.productName, style: context.text.titleSmall, maxLines: 2, overflow: TextOverflow.ellipsis),
                AnimatedSize(
                  duration: Motion.medium,
                  alignment: Alignment.topLeft,
                  child: options.isEmpty
                      ? const SizedBox(width: double.infinity)
                      : Padding(
                          padding: const EdgeInsets.only(top: 2),
                          child: Text(options, style: context.text.bodySmall),
                        ),
                ),
                if (item.notes != null && item.notes!.isNotEmpty)
                  Padding(
                    padding: const EdgeInsets.only(top: 2),
                    child: Text(
                      '“${item.notes}”',
                      style: context.text.bodySmall?.copyWith(fontStyle: FontStyle.italic),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                const SizedBox(height: 10),
                Row(
                  children: [
                    Expanded(
                      child: AnimatedMoney(
                        cents: item.lineTotalCents,
                        currency: currency,
                        style: context.text.titleMedium!.copyWith(fontWeight: FontWeight.w700),
                      ),
                    ),
                    QuantityStepper(
                      value: item.quantity,
                      compact: true,
                      decrementIcon: item.quantity == 1 ? Icons.delete_outline_rounded : null,
                      onChanged: onQuantity,
                    ),
                  ],
                ),
              ],
            ),
          ),
        ],
      ),
    );
  }
}
