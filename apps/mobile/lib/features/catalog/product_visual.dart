import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../shared/product_kinds.dart';
import 'catalog_providers.dart';

/// What to picture for a cart or order line, which carries only the product
/// id: the photo and kind from the store's menu, else from the product
/// details ([detail]) when the menu no longer lists it.
({String? imageUrl, ProductKind? kind}) productVisualFor(
  WidgetRef ref,
  String storeId,
  String productId, {
  ProductDetail? detail,
}) {
  final menu = ref.watch(menuProvider(storeId)).valueOrNull?.value;
  final listed = menu == null ? null : menuProductOf(menu, productId);
  return (
    imageUrl: listed?.imageUrl ?? detail?.imageUrl,
    kind:
        (listed == null ? null : productKindOf(listed, menu: menu)) ?? (detail == null ? null : productKindOf(detail)),
  );
}
