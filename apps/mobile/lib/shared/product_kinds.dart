import 'package:takeaway_api/takeaway_api.dart';

/// What a product is, by the kind of its menu category. Picks the
/// illustration for a product without a photo, whether the caffeine chip and
/// «Пожелание бариста» make sense, and what the cart suggests next to a drink.
enum ProductKind {
  hotDrinks('HOT_DRINKS', 'hot-drink'),
  coldDrinks('COLD_DRINKS', 'cold-drink'),
  food('FOOD', 'food'),
  bakery('BAKERY', 'bakery'),
  other('OTHER', 'other');

  const ProductKind(this.wire, this._file);

  /// The value in the API's `kind` / `categoryKind`.
  final String wire;
  final String _file;

  /// Copies of `libs/ui-kit/src/assets/product-placeholders`.
  String get placeholderAsset => 'assets/product-placeholders/$_file.svg';

  bool get isDrink => this == hotDrinks || this == coldDrinks;

  /// Something to eat — what the cart offers next to a drink.
  bool get isFood => this == food || this == bakery;

  /// The kind the API names; null for none, or one this build does not know.
  static ProductKind? tryParse(String? raw) {
    final value = raw?.trim().toUpperCase();
    if (value == null || value.isEmpty) return null;
    for (final kind in values) {
      if (kind.wire == value) return kind;
    }
    return null;
  }
}

/// [product]'s kind: its own `categoryKind`, else the `kind` of its category
/// — given as [categoryKind], or looked up in [menu]. Null when nothing says
/// (API versions that predate kinds); placeholders then use
/// [ProductKind.other].
ProductKind? productKindOf(Product product, {Menu? menu, String? categoryKind}) =>
    ProductKind.tryParse(product.categoryKind) ??
    ProductKind.tryParse(categoryKind) ??
    (menu == null ? null : ProductKind.tryParse(menuCategoryOf(menu, product.categoryId)?.kind));

/// The category with [categoryId] in [menu].
MenuCategory? menuCategoryOf(Menu menu, String categoryId) {
  for (final category in menu.categories) {
    if (category.id == categoryId) return category;
  }
  return null;
}

/// The product with [productId] in [menu].
Product? menuProductOf(Menu menu, String productId) {
  for (final product in menu.allProducts) {
    if (product.id == productId) return product;
  }
  return null;
}
