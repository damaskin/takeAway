import 'package:takeaway_api/takeaway_api.dart';

import '../../shared/product_kinds.dart';

/// A product offered next to what the customer has chosen.
typedef Suggestion = ({Product product, ProductKind kind});

/// Up to [limit] things to eat from [menu], to offer next to a drink: bakery
/// first (it goes with coffee), then food, each in menu order. Nothing sold
/// out, nothing in [exclude]. Add-ons-only categories never reach the app —
/// the API leaves them out of the menu.
List<Suggestion> foodSuggestions(Menu menu, {int limit = 6, Set<String> exclude = const {}}) {
  final bakery = <Suggestion>[];
  final food = <Suggestion>[];
  for (final category in menu.visibleCategories) {
    for (final product in category.products) {
      if (product.onStopList || exclude.contains(product.id)) continue;
      final kind = productKindOf(product, categoryKind: category.kind);
      if (kind == ProductKind.bakery) bakery.add((product: product, kind: ProductKind.bakery));
      if (kind == ProductKind.food) food.add((product: product, kind: ProductKind.food));
    }
  }
  return [...bakery, ...food].take(limit).toList();
}

/// Whether [cart] holds a drink and nothing to eat yet, going by the kinds
/// [menu] gives its lines — then the cart offers [foodSuggestions]. Lines
/// whose kind is not known count as neither.
bool wantsFood(Cart cart, Menu menu) {
  var drink = false;
  for (final item in cart.items) {
    final product = menuProductOf(menu, item.productId);
    final kind = product == null ? null : productKindOf(product, menu: menu);
    if (kind?.isFood ?? false) return false;
    if (kind?.isDrink ?? false) drink = true;
  }
  return drink;
}
