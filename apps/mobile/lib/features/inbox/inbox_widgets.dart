import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../app/router.dart';
import '../../core/providers.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/cup_logo.dart';
import '../../shared/widgets/product_image.dart';
import 'inbox_providers.dart';

/// The bell in the stores and menu headers: opens «Уведомления», with the
/// number of unread messages on it. Not shown to guests.
class InboxBell extends ConsumerWidget {
  const InboxBell({this.overMap = false, super.key});

  /// Next to the search field over the map: as tall as the field, with its
  /// border, and lifted off the tiles.
  final bool overMap;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    if (!ref.watch(isSignedInProvider)) return const SizedBox.shrink();
    final brand = context.brand;
    final unread = ref.watch(inboxUnreadProvider);
    final bell = IconButton.filledTonal(
      key: const ValueKey('inbox-bell'),
      onPressed: () => context.push(Routes.inbox),
      tooltip: AppLocalizations.of(context).inboxTitle,
      style: IconButton.styleFrom(
        backgroundColor: brand.foam,
        fixedSize: overMap ? const Size.square(52) : null,
        elevation: overMap ? 1.5 : null,
        shadowColor: overMap ? Colors.black.withValues(alpha: 0.2) : null,
        side: overMap ? BorderSide(color: brand.border) : null,
        shape: overMap ? RoundedRectangleBorder(borderRadius: BorderRadius.circular(Radii.input)) : null,
      ),
      icon: Badge.count(
        count: unread,
        isLabelVisible: unread > 0,
        backgroundColor: brand.caramel,
        child: Icon(unread > 0 ? Icons.notifications_rounded : Icons.notifications_none_rounded),
      ),
    );
    return overMap ? Padding(padding: const EdgeInsets.only(left: 8), child: bell) : bell;
  }
}

/// Who a message is from: the brand's logo on a white tile, or the takeAway
/// cup for the platform's own announcements.
class InboxAvatar extends StatelessWidget {
  const InboxAvatar({required this.sender, this.size = 44, super.key});

  final InboxSender sender;
  final double size;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final radius = BorderRadius.circular(size * 0.29);
    if (sender.kind == InboxSenderKind.platform) {
      return Container(
        width: size,
        height: size,
        alignment: Alignment.center,
        decoration: BoxDecoration(color: brand.caramelSoft, borderRadius: radius),
        child: CupLogo(size: size * 0.86),
      );
    }
    final placeholder = ColoredBox(
      color: brand.caramelSoft,
      child: Center(
        child: Icon(Icons.storefront_rounded, color: brand.caramel, size: size * 0.5),
      ),
    );
    final url = sender.logoUrl;
    return ClipRRect(
      borderRadius: radius,
      child: SizedBox.square(
        dimension: size,
        child: !ProductImage.isUsable(url)
            ? placeholder
            : CachedNetworkImage(
                imageUrl: url!,
                fadeInDuration: Motion.fast,
                imageBuilder: (_, image) => DecoratedBox(
                  decoration: BoxDecoration(
                    color: Colors.white,
                    borderRadius: radius,
                    border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
                  ),
                  child: Padding(
                    padding: EdgeInsets.all(size * 0.12),
                    child: Image(image: image, fit: BoxFit.contain),
                  ),
                ),
                placeholder: (_, _) => const ColoredBox(color: Colors.white),
                errorWidget: (_, _, _) => placeholder,
              ),
      ),
    );
  }
}

/// The dot on a message the customer has not opened yet.
class InboxUnreadDot extends StatelessWidget {
  const InboxUnreadDot({super.key});

  @override
  Widget build(BuildContext context) => Semantics(
    label: AppLocalizations.of(context).inboxUnread,
    child: Container(
      key: const ValueKey('inbox-unread-dot'),
      width: 9,
      height: 9,
      decoration: BoxDecoration(color: context.brand.caramel, shape: BoxShape.circle),
    ),
  );
}

/// The unread count at the end of the profile's «Уведомления» row.
class InboxCountPill extends StatelessWidget {
  const InboxCountPill({required this.count, super.key});

  final int count;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 2),
    decoration: BoxDecoration(color: context.brand.caramel, borderRadius: BorderRadius.circular(Radii.pill)),
    child: Text(
      count > 99 ? '99+' : '$count',
      style: context.text.labelSmall?.copyWith(color: Colors.white, fontWeight: FontWeight.w700),
    ),
  );
}
