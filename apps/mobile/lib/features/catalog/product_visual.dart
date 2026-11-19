import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../shared/product_kinds.dart';
import '../../shared/widgets/product_image.dart';
import 'catalog_providers.dart';

/// The photo of a cart or order line, which carries only the product id:
/// from the store's menu, else from the product details, fetched when the
/// loaded menu no longer lists the product. Null when there is no photo to
/// show; the line then goes without an image.
String? productPhotoFor(WidgetRef ref, String storeId, String productId) {
  final menu = ref.watch(menuProvider(storeId));
  final loaded = menu.valueOrNull?.value;
  final listed = loaded == null ? null : menuProductOf(loaded, productId);
  var url = listed?.imageUrl;
  if (url == null && listed == null && loaded != null) {
    url = ref.watch(productDetailProvider(productId)).valueOrNull?.imageUrl;
  }
  return ProductImage.isUsable(url) ? url : null;
}
