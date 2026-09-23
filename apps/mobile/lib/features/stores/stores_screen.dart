import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../app/router.dart';
import '../../core/storage/app_prefs.dart';
import '../../core/theme/tokens.dart';
import '../../l10n/app_localizations.dart';
import '../../shared/directions.dart';
import '../../shared/widgets/skeleton.dart';
import '../../shared/widgets/state_views.dart';
import '../../shared/widgets/store_map.dart';
import '../catalog/catalog_providers.dart';
import 'store_widgets.dart';

/// Map of stores with a draggable list over it — search, "open now", and
/// "near me"; picking a store switches the menu to it.
class StoresScreen extends ConsumerStatefulWidget {
  const StoresScreen({super.key});

  @override
  ConsumerState<StoresScreen> createState() => _StoresScreenState();
}

class _StoresScreenState extends ConsumerState<StoresScreen> {
  final _map = MapController();
  final _search = TextEditingController();
  bool _openOnly = false;
  String? _focused;
  bool _mapReady = false;

  @override
  void dispose() {
    _search.dispose();
    super.dispose();
  }

  List<StoreWithDistance> _filter(List<StoreWithDistance> all) {
    final q = _search.text.trim().toLowerCase();
    return all.where((item) {
      final s = item.store;
      if (_openOnly && !s.isOpen) return false;
      if (q.isEmpty) return true;
      return '${s.name} ${s.addressLine} ${s.city}'.toLowerCase().contains(q);
    }).toList();
  }

  void _focus(Store store) {
    setState(() => _focused = store.id);
    if (_mapReady && store.hasLocation) {
      _map.move(LatLng(store.latitude, store.longitude), 16);
    }
  }

  void _order(Store store) {
    ref.read(activeStoreIdProvider.notifier).select(store.id);
    context.go(Routes.menu);
  }

  void _fitAll(List<StoreWithDistance> list, LatLng? me) {
    if (!_mapReady) return;
    final points = [
      for (final item in list)
        if (item.store.hasLocation) LatLng(item.store.latitude, item.store.longitude),
      ?me,
    ];
    if (points.isEmpty) return;
    if (points.length == 1) {
      _map.move(points.first, 15);
      return;
    }
    _map.fitCamera(
      CameraFit.coordinates(coordinates: points, padding: const EdgeInsets.fromLTRB(48, 48, 48, 260), maxZoom: 16),
    );
  }

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final brand = context.brand;
    final async = ref.watch(sortedStoresProvider);
    final me = ref.watch(userLocationProvider);
    final activeId = ref.watch(activeStoreProvider)?.id;
    final list = _filter(async.valueOrNull ?? const []);
    final located = list.where((i) => i.store.hasLocation).toList();

    ref.listen(userLocationProvider, (_, next) {
      if (next != null) _fitAll(list, next);
    });

    return Scaffold(
      body: Stack(
        children: [
          Positioned.fill(
            child: FlutterMap(
              mapController: _map,
              options: MapOptions(
                initialCenter: located.isNotEmpty
                    ? LatLng(located.first.store.latitude, located.first.store.longitude)
                    : me ?? const LatLng(46.84, 29.63),
                onMapReady: () {
                  _mapReady = true;
                  _fitAll(list, me);
                },
                onTap: (_, _) => setState(() => _focused = null),
              ),
              children: [
                osmTiles(context),
                MarkerLayer(
                  markers: [
                    if (me != null) Marker(point: me, width: 24, height: 24, child: const UserDot()),
                    for (final item in located)
                      Marker(
                        point: LatLng(item.store.latitude, item.store.longitude),
                        width: 48,
                        height: 58,
                        alignment: Alignment.topCenter,
                        child: GestureDetector(
                          onTap: () => _focus(item.store),
                          child: StorePin(
                            color: item.store.effectiveStatus == StoreStatus.closed
                                ? brand.textTertiary
                                : brand.busy(item.store.busyMeter) == brand.mint
                                ? brand.caramel
                                : brand.busy(item.store.busyMeter),
                            highlighted: item.store.id == _focused || item.store.id == activeId,
                          ),
                        ),
                      ),
                  ],
                ),
                const SimpleAttributionWidget(source: Text('OpenStreetMap')),
              ],
            ),
          ),
          SafeArea(
            child: Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 16, 0),
              child: Row(
                children: [
                  Expanded(
                    child: Material(
                      color: Colors.transparent,
                      child: TextField(
                        controller: _search,
                        onChanged: (_) => setState(() {}),
                        decoration: InputDecoration(
                          hintText: l10n.storesSearchHint,
                          prefixIcon: const Icon(Icons.search_rounded),
                          suffixIcon: _search.text.isEmpty
                              ? null
                              : IconButton(
                                  icon: const Icon(Icons.close_rounded),
                                  onPressed: () => setState(_search.clear),
                                ),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filled(
                    style: IconButton.styleFrom(backgroundColor: brand.foam, foregroundColor: brand.caramel),
                    tooltip: l10n.storesNearMe,
                    onPressed: () async {
                      final result = await ref.read(userLocationProvider.notifier).request();
                      if (!context.mounted) return;
                      if (!result.ok) {
                        showLocationProblem(context, ref, result.status);
                      } else {
                        _fitAll(list, result.position);
                      }
                    },
                    icon: const Icon(Icons.my_location_rounded),
                  ),
                ],
              ),
            ),
          ),
          DraggableScrollableSheet(
            initialChildSize: 0.42,
            minChildSize: 0.2,
            maxChildSize: 0.88,
            snap: true,
            snapSizes: const [0.2, 0.42, 0.88],
            builder: (context, controller) => Container(
              decoration: BoxDecoration(
                color: brand.cream,
                borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
                boxShadow: brand.liftedShadow,
              ),
              child: CustomScrollView(
                controller: controller,
                slivers: [
                  SliverToBoxAdapter(
                    child: Column(
                      children: [
                        const SizedBox(height: 10),
                        Container(
                          width: 36,
                          height: 4,
                          decoration: BoxDecoration(color: brand.border, borderRadius: BorderRadius.circular(2)),
                        ),
                        Padding(
                          padding: const EdgeInsets.fromLTRB(20, 14, 20, 8),
                          child: Row(
                            children: [
                              Text(l10n.storesTitle, style: context.text.headlineSmall),
                              const Spacer(),
                              FilterChip(
                                label: Text(l10n.storesFilterOpen),
                                selected: _openOnly,
                                selectedColor: brand.caramel,
                                labelStyle: context.text.labelMedium?.copyWith(
                                  color: _openOnly ? Colors.white : brand.textPrimary,
                                ),
                                onSelected: (v) => setState(() => _openOnly = v),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  async.when(
                    loading: () => SliverList.list(
                      children: [
                        for (var i = 0; i < 3; i++)
                          const Padding(
                            padding: EdgeInsets.fromLTRB(16, 0, 16, 12),
                            child: ShimmerScope(child: Skeleton(height: 96, radius: Radii.card)),
                          ),
                      ],
                    ),
                    error: (error, _) => SliverToBoxAdapter(
                      child: ErrorState(error: error, onRetry: () => ref.invalidate(storesProvider), compact: true),
                    ),
                    data: (_) => list.isEmpty
                        ? SliverToBoxAdapter(
                            child: EmptyState(icon: Icons.search_off_rounded, title: l10n.storesEmpty, compact: true),
                          )
                        : SliverPadding(
                            padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                            sliver: SliverList.separated(
                              itemCount: list.length,
                              separatorBuilder: (_, _) => const SizedBox(height: 12),
                              itemBuilder: (context, index) {
                                final item = list[index];
                                final store = item.store;
                                final expanded = store.id == _focused;
                                return Column(
                                  children: [
                                    StoreTile(
                                      item: item,
                                      selected: store.id == activeId || expanded,
                                      onTap: () => expanded ? _order(store) : _focus(store),
                                    ),
                                    AnimatedSize(
                                      duration: Motion.medium,
                                      curve: Motion.emphasized,
                                      child: expanded
                                          ? Padding(
                                              padding: const EdgeInsets.only(top: 8),
                                              child: Row(
                                                children: [
                                                  if (store.hasLocation)
                                                    Expanded(
                                                      child: OutlinedButton.icon(
                                                        onPressed: () => openDirections(
                                                          store.latitude,
                                                          store.longitude,
                                                          label: store.name,
                                                        ),
                                                        icon: const Icon(Icons.directions_rounded),
                                                        label: Text(l10n.buildRoute),
                                                      ),
                                                    ),
                                                  if (store.hasLocation) const SizedBox(width: 8),
                                                  Expanded(
                                                    child: FilledButton.icon(
                                                      onPressed: () => _order(store),
                                                      style: FilledButton.styleFrom(
                                                        minimumSize: const Size.fromHeight(50),
                                                      ),
                                                      icon: const Icon(Icons.local_cafe_rounded),
                                                      label: Text(l10n.orderHere),
                                                    ),
                                                  ),
                                                ],
                                              ),
                                            )
                                          : const SizedBox(width: double.infinity),
                                    ),
                                  ],
                                );
                              },
                            ),
                          ),
                  ),
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }
}
