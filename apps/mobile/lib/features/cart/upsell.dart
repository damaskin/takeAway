import 'package:takeaway_api/takeaway_api.dart';

import '../../shared/product_kinds.dart';
import '../../shared/widgets/product_image.dart';

/// A product offered next to what the customer has chosen.
typedef Suggestion = ({Product product, ProductKind kind});

/// What customers bought together with the products in hand, from the
/// store's [answer]: up to [limit] products of [menu] in the answer's order —
/// only those the menu still sells, in stock and not in [exclude]; with a
/// photo when any has one, as in [foodSuggestions]. Empty unless the answer
/// is `copurchase`: only then may the row say «Часто берут вместе».
List<Suggestion> boughtTogether(Menu menu, StoreSuggestions? answer, {int limit = 6, Set<String> exclude = const {}}) {
  if (answer == null || !answer.boughtTogether) return const [];
  final onMenu = <String, Suggestion>{};
  for (final category in menu.visibleCategories) {
    for (final product in category.products) {
      if (product.onStopList) continue;
      final kind = productKindOf(product, categoryKind: category.kind) ?? ProductKind.other;
      onMenu[product.id] = (product: product, kind: kind);
    }
  }
  final taken = {...exclude};
  final all = <Suggestion>[];
  for (final id in answer.productIds) {
    final suggestion = onMenu[id];
    if (suggestion != null && taken.add(id)) all.add(suggestion);
  }
  return _picturedIfAny(all).take(limit).toList();
}

/// Up to [limit] things to eat from [menu], to offer next to a drink: bakery
/// first (it goes with coffee), then food, each in menu order. Nothing sold
/// out, nothing in [exclude]. Add-ons-only categories never reach the app —
/// the API leaves them out of the menu. The menu rule: what the row offers
/// while the store has too few orders to say what goes together, or cannot
/// be asked.
///
/// Only products with a photo when any has one: a text card next to photo
/// cards reads as a picture that failed to load. A menu with no photos at
/// all still gets text cards.
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
  return _picturedIfAny([...bakery, ...food]).take(limit).toList();
}

/// [all] with a photo, or all of them when none has one.
List<Suggestion> _picturedIfAny(List<Suggestion> all) {
  final pictured = all.where((s) => ProductImage.isUsable(s.product.imageUrl)).toList();
  return pictured.isEmpty ? all : pictured;
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
