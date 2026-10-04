import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/format/time.dart';
import '../../core/location/location_service.dart';
import '../../core/storage/app_prefs.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/widgets/chips.dart';
import '../../shared/widgets/pressable.dart';
import '../../shared/widgets/product_image.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import '../catalog/catalog_providers.dart';

/// "—" is what POS imports write for an unknown address; treat it as none.
String? displayAddress(Store store) {
  final parts = [store.addressLine, store.city].map((p) => p.trim()).where((p) => p.isNotEmpty && p != '—' && p != '-');
  final text = parts.join(', ');
  return text.isEmpty ? null : text;
}

/// The business's logo, whole, on a light rounded tile — or, when the
/// business has not uploaded one or it fails to load, the quiet storefront
/// tile store cards had before logos.
///
/// Logos come in every shape: wide wordmarks, square marks, transparent
/// PNGs drawn in black. Filling the square cropped the wordmarks, and a
/// transparent logo vanished on the dark theme; fitted inside a white tile
/// with a margin every one of them stays whole and legible, and the tile
/// looks the same in both themes, as a printed sticker would.
class StoreLogo extends StatelessWidget {
  const StoreLogo({required this.store, this.size = 48, super.key});

  /// The tile behind a logo, whatever the theme.
  static const tileColor = Color(0xFFFFFFFF);

  final Store store;
  final double size;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final url = store.logoUrl;
    final radius = BorderRadius.circular(size * 0.29);
    final placeholder = ColoredBox(
      color: brand.caramelSoft,
      child: Center(
        child: Icon(Icons.storefront_rounded, color: brand.caramel, size: size * 0.5),
      ),
    );
    if (!ProductImage.isUsable(url)) {
      return ClipRRect(
        borderRadius: radius,
        child: SizedBox.square(dimension: size, child: placeholder),
      );
    }
    return ClipRRect(
      borderRadius: radius,
      child: SizedBox.square(
        dimension: size,
        child: CachedNetworkImage(
          imageUrl: url!,
          fadeInDuration: Motion.fast,
          imageBuilder: (_, image) => DecoratedBox(
            decoration: BoxDecoration(
              color: tileColor,
              borderRadius: radius,
              border: Border.all(color: Colors.black.withValues(alpha: 0.06)),
            ),
            child: Padding(
              padding: EdgeInsets.all(size * 0.12),
              child: Image(image: image, fit: BoxFit.contain),
            ),
          ),
          placeholder: (_, _) => const ColoredBox(color: tileColor),
          errorWidget: (_, _, _) => placeholder,
        ),
      ),
    );
  }
}

/// One store row: logo, name, address, distance, live ETA and status.
class StoreTile extends StatelessWidget {
  const StoreTile({
    required this.item,
    required this.onTap,
    this.selected = false,
    this.enabled = true,
    bool? dimmed,
    this.trailing,
    super.key,
  }) : dimmed = dimmed ?? !enabled;

  final StoreWithDistance item;
  final VoidCallback onTap;
  final bool selected;

  /// False ignores taps — a store that is not taking orders cannot be picked.
  final bool enabled;

  /// Greys the row out. Follows [enabled] unless set: the Stores tab greys
  /// a closed store but still lets it be tapped, to find it on the map.
  final bool dimmed;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final l10n = AppLocalizations.of(context);
    final store = item.store;
    final address = displayAddress(store);
    final locale = Localizations.localeOf(context).languageCode;

    final tile = Pressable(
      onTap: enabled ? onTap : null,
      child: AnimatedContainer(
        duration: Motion.medium,
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: brand.foam,
          borderRadius: BorderRadius.circular(Radii.card),
          border: Border.all(color: selected ? brand.caramel : brand.borderLight, width: selected ? 1.6 : 1),
          boxShadow: selected ? brand.softShadow : null,
        ),
        child: Row(
          children: [
            StoreLogo(store: store),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(store.name, style: context.text.titleMedium, maxLines: 1, overflow: TextOverflow.ellipsis),
                  if (address != null) ...[
                    const SizedBox(height: 2),
                    Text(address, style: context.text.bodySmall, maxLines: 1, overflow: TextOverflow.ellipsis),
                  ],
                  const SizedBox(height: 8),
                  Wrap(
                    spacing: 10,
                    runSpacing: 6,
                    crossAxisAlignment: WrapCrossAlignment.center,
                    children: [
                      if (store.isOpen)
                        EtaChip(etaSeconds: store.currentEtaSeconds, busyMeter: store.busyMeter, dense: true),
                      StoreStatusBadge(status: store.effectiveStatus, notWorking: store.isInactive),
                      if (item.distanceMeters != null)
                        Text(
                          l10n.distanceAway(formatDistance(item.distanceMeters!, locale: locale)),
                          style: context.text.labelMedium?.copyWith(color: brand.textSecondary),
                        ),
                    ],
                  ),
                ],
              ),
            ),
            if (trailing != null) ...[const SizedBox(width: 8), trailing!],
          ],
        ),
      ),
    );
    return dimmed ? Opacity(opacity: 0.5, child: tile) : tile;
  }
}

/// Compact store chooser used from the menu header and first launch.
Future<void> showStorePicker(BuildContext context) => showModalBottomSheet<void>(
  context: context,
  isScrollControlled: true,
  useSafeArea: true,
  builder: (_) => DraggableScrollableSheet(
    expand: false,
    initialChildSize: 0.7,
    maxChildSize: 0.92,
    minChildSize: 0.4,
    builder: (context, controller) =>
        StorePickerList(scrollController: controller, onPicked: () => Navigator.pop(context)),
  ),
);

class StorePickerList extends ConsumerWidget {
  const StorePickerList({this.scrollController, this.onPicked, this.header = true, super.key});

  final ScrollController? scrollController;
  final VoidCallback? onPicked;
  final bool header;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final l10n = AppLocalizations.of(context);
    final stores = ref.watch(sortedStoresProvider);
    final activeId = ref.watch(activeStoreProvider)?.id;

    return CustomScrollView(
      controller: scrollController,
      slivers: [
        if (header)
          SliverPadding(
            padding: const EdgeInsets.fromLTRB(24, 0, 24, 16),
            sliver: SliverToBoxAdapter(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(l10n.chooseStoreTitle, style: context.text.headlineMedium),
                  const SizedBox(height: 6),
                  Text(
                    l10n.chooseStoreSubtitle,
                    style: context.text.bodyMedium?.copyWith(color: context.brand.textSecondary),
                  ),
                  const SizedBox(height: 12),
                  _NearMeButton(),
                ],
              ),
            ),
          ),
        stores.when(
          skipError: true,
          loading: () => SliverPadding(
            padding: const EdgeInsets.symmetric(horizontal: 16),
            sliver: SliverList.separated(
              itemCount: 3,
              separatorBuilder: (_, _) => const SizedBox(height: 12),
              itemBuilder: (_, _) => const ShimmerScope(child: Skeleton(height: 96, radius: Radii.card)),
            ),
          ),
          error: (error, _) => SliverFillRemaining(
            hasScrollBody: false,
            child: ErrorState(error: error, onRetry: () => ref.invalidate(storesProvider), compact: true),
          ),
          data: (list) {
            if (list.isEmpty) {
              return SliverFillRemaining(
                hasScrollBody: false,
                child: EmptyState(icon: Icons.storefront_outlined, title: l10n.storesEmpty, compact: true),
              );
            }
            // Only a store taking orders right now can be picked; the rest
            // stay visible below so the customer knows they exist.
            final active = [
              for (final item in list)
                if (item.store.isOpen) item,
            ];
            final inactive = [
              for (final item in list)
                if (!item.store.isOpen) item,
            ];
            Widget tile(StoreWithDistance item, {required bool enabled}) {
              final chosen = item.store.id == activeId;
              return StoreTile(
                item: item,
                enabled: enabled,
                selected: chosen,
                trailing: chosen ? Icon(Icons.check_circle_rounded, color: context.brand.caramel) : null,
                onTap: () {
                  ref.read(activeStoreIdProvider.notifier).select(item.store.id);
                  onPicked?.call();
                },
              );
            }

            return SliverPadding(
              padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
              sliver: SliverList.list(
                children: [
                  if (active.isEmpty)
                    Padding(
                      padding: const EdgeInsets.fromLTRB(8, 4, 8, 8),
                      child: Text(
                        l10n.storesNoneActive,
                        style: context.text.bodyMedium?.copyWith(color: context.brand.textSecondary),
                      ),
                    ),
                  for (final item in active) ...[tile(item, enabled: true), const SizedBox(height: 12)],
                  if (inactive.isNotEmpty) ...[
                    Padding(
                      padding: const EdgeInsets.fromLTRB(8, 12, 8, 10),
                      child: Text(
                        l10n.storesInactiveTitle,
                        style: context.text.titleSmall?.copyWith(color: context.brand.textSecondary),
                      ),
                    ),
                    for (final item in inactive) ...[tile(item, enabled: false), const SizedBox(height: 12)],
                  ],
                ],
              ),
            );
          },
        ),
      ],
    );
  }
}

class _NearMeButton extends ConsumerStatefulWidget {
  @override
  ConsumerState<_NearMeButton> createState() => _NearMeButtonState();
}

class _NearMeButtonState extends ConsumerState<_NearMeButton> {
  bool _busy = false;

  Future<void> _locate() async {
    setState(() => _busy = true);
    final result = await ref.read(userLocationProvider.notifier).request();
    if (!mounted) return;
    setState(() => _busy = false);
    if (!result.ok) showLocationProblem(context, ref, result.status);
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final located = ref.watch(userLocationProvider) != null;
    return ActionChip(
      avatar: _busy
          ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
          : Icon(located ? Icons.near_me_rounded : Icons.near_me_outlined, size: 18, color: context.brand.caramel),
      label: Text(l10n.storesNearMe),
      onPressed: _busy ? null : _locate,
    );
  }
}

void showLocationProblem(BuildContext context, WidgetRef ref, LocationStatus status) {
  final l10n = AppLocalizations.of(context);
  Snack.show(
    context,
    status == LocationStatus.serviceOff ? l10n.locationServiceOff : l10n.locationDenied,
    icon: Icons.location_off_outlined,
    actionLabel: l10n.openSettings,
    onAction: () => ref.read(locationServiceProvider).openSettings(),
  );
}
