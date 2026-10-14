import 'package:flutter/widgets.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../app/router.dart';
import '../../core/storage/app_prefs.dart';
import '../catalog/catalog_providers.dart';

/// Where a message leads: one store's menu, or the list of places.
@immutable
class InboxTarget {
  const InboxTarget.menu(String this.storeId);

  const InboxTarget.places() : storeId = null;

  /// The store whose menu opens; null for the list of places.
  final String? storeId;

  bool get opensMenu => storeId != null;

  @override
  bool operator ==(Object other) => other is InboxTarget && other.storeId == storeId;

  @override
  int get hashCode => storeId.hashCode;
}

/// What [link] opens: a STORE link — that store's menu; a BRAND link — its
/// store's menu when it has one, the list of places when the API left the
/// store out because the brand has several. Null when there is nothing to
/// open.
InboxTarget? inboxLinkTarget(InboxLink? link) {
  if (link == null) return null;
  final storeId = link.storeId;
  if (storeId != null && storeId.isNotEmpty) return InboxTarget.menu(storeId);
  return link.kind == InboxLinkKind.brand ? const InboxTarget.places() : null;
}

/// For a brand's campaign that links nowhere: the brand's own menu when
/// [stores] has one store of it, its places when it has several.
InboxTarget? inboxSenderTarget(InboxItem item, List<Store> stores) {
  final brandId = item.sender.brandId;
  if (item.kind != InboxItemKind.brandCampaign || item.link != null || brandId == null) return null;
  final own = stores.where((store) => store.brandId == brandId).toList();
  if (own.isEmpty) return null;
  return own.length == 1 ? InboxTarget.menu(own.single.id) : const InboxTarget.places();
}

/// Opens [target] the way the stores tab does: the store becomes the one
/// the menu tab shows. A store the list on hand does not have yet makes it
/// read again, so the menu does not fall back to "pick a store".
void openInboxTarget(BuildContext context, WidgetRef ref, InboxTarget target) {
  final storeId = target.storeId;
  if (storeId == null) {
    context.go(Routes.stores);
    return;
  }
  if (ref.read(liveStoreProvider(storeId)) == null) ref.invalidate(storesProvider);
  ref.read(activeStoreIdProvider.notifier).select(storeId);
  context.go(Routes.menu);
}
