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
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import '../catalog/catalog_providers.dart';

/// "—" is what POS imports write for an unknown address; treat it as none.
String? displayAddress(Store store) {
  final parts = [store.addressLine, store.city].map((p) => p.trim()).where((p) => p.isNotEmpty && p != '—' && p != '-');
  final text = parts.join(', ');
  return text.isEmpty ? null : text;
}

/// One store row: name, address, distance, live ETA and status.
class StoreTile extends StatelessWidget {
  const StoreTile({required this.item, required this.onTap, this.selected = false, this.trailing, super.key});

  final StoreWithDistance item;
  final VoidCallback onTap;
  final bool selected;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    final brand = context.brand;
    final l10n = AppLocalizations.of(context);
    final store = item.store;
    final address = displayAddress(store);
    final locale = Localizations.localeOf(context).languageCode;

    return Pressable(
      onTap: onTap,
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
            Container(
              width: 48,
              height: 48,
              decoration: BoxDecoration(color: brand.caramelSoft, borderRadius: BorderRadius.circular(14)),
              child: Icon(Icons.storefront_rounded, color: brand.caramel),
            ),
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
                      StoreStatusBadge(status: store.effectiveStatus),
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
          data: (list) => list.isEmpty
              ? SliverFillRemaining(
                  hasScrollBody: false,
                  child: EmptyState(icon: Icons.storefront_outlined, title: l10n.storesEmpty, compact: true),
                )
              : SliverPadding(
                  padding: const EdgeInsets.fromLTRB(16, 0, 16, 24),
                  sliver: SliverList.separated(
                    itemCount: list.length,
                    separatorBuilder: (_, _) => const SizedBox(height: 12),
                    itemBuilder: (context, index) {
                      final item = list[index];
                      return StoreTile(
                        item: item,
                        selected: item.store.id == activeId,
                        trailing: item.store.id == activeId
                            ? Icon(Icons.check_circle_rounded, color: context.brand.caramel)
                            : null,
                        onTap: () {
                          ref.read(activeStoreIdProvider.notifier).select(item.store.id);
                          onPicked?.call();
                        },
                      );
                    },
                  ),
                ),
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
