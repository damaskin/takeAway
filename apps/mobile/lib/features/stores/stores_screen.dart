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
import 'map_focus.dart';
import 'store_widgets.dart';

/// Map of stores with a draggable list over it — search, "open now", and
/// "near me"; picking a store switches the menu to it. The first screen a
/// new customer sees after the intro.
class StoresScreen extends ConsumerStatefulWidget {
  const StoresScreen({super.key});

  /// Sheet height a tapped pin raises the list to, so its store shows.
  static const focusSheetSize = 0.42;

  @override
  ConsumerState<StoresScreen> createState() => _StoresScreenState();
}

class _StoresScreenState extends ConsumerState<StoresScreen> {
  final _map = MapController();
  final _sheet = DraggableScrollableController();
  final _search = TextEditingController();
  ScrollController? _list;
  bool _openOnly = false;
  bool _mapReady = false;

  /// Whether the camera has been fitted to the stores yet. The list may land
  /// after the map is ready (a cold start always does), so the first fit
  /// waits for whichever comes second.
  bool _fitted = false;

  /// The store whose row is expanded and pin enlarged.
  String? _focused;

  /// A store picked on the map, lifted to the top of the list so the sheet
  /// shows it however far down the list it was.
  String? _lifted;

  @override
  void dispose() {
    _search.dispose();
    _sheet.dispose();
    _map.dispose();
    super.dispose();
  }

  List<StoreWithDistance> _filter(List<StoreWithDistance> all) {
    final q = _search.text.trim().toLowerCase();
    final list = all.where((item) {
      final s = item.store;
      if (_openOnly && !s.isOpen) return false;
      if (q.isEmpty) return true;
      return '${s.name} ${s.addressLine} ${s.city}'.toLowerCase().contains(q);
    }).toList();
    // Stores taking orders first, each group in the provider's order
    // (nearest, or shortest wait); then the pin the customer just tapped.
    final open = [
      for (final i in list)
        if (i.store.isOpen) i,
    ];
    final closed = [
      for (final i in list)
        if (!i.store.isOpen) i,
    ];
    final ordered = [...open, ...closed];
    final lifted = ordered.indexWhere((i) => i.store.id == _lifted);
    if (lifted > 0) ordered.insert(0, ordered.removeAt(lifted));
    return ordered;
  }

  /// A row tapped in the list: expand it and show it on the map.
  void _focus(Store store) {
    setState(() => _focused = store.id);
    if (_mapReady && store.hasLocation) {
      _map.move(LatLng(store.latitude, store.longitude), 16);
    }
  }

  /// A pin tapped on the map: the same, plus bring the sheet up with the
  /// store at the top of the list.
  void _focusFromMap(Store store) {
    setState(() {
      _focused = store.id;
      _lifted = store.id;
    });
    if (_mapReady && store.hasLocation) {
      _map.move(LatLng(store.latitude, store.longitude), _map.camera.zoom < 15 ? 15 : _map.camera.zoom);
    }
    if (_sheet.isAttached && _sheet.size < StoresScreen.focusSheetSize) {
      _sheet.animateTo(StoresScreen.focusSheetSize, duration: Motion.medium, curve: Motion.emphasized);
    }
    final list = _list;
    if (list != null && list.hasClients && list.offset > 0) {
      list.animateTo(0, duration: Motion.medium, curve: Motion.emphasized);
    }
  }

  void _clearFocus() {
    if (_focused == null && _lifted == null) return;
    setState(() {
      _focused = null;
      _lifted = null;
    });
  }

  void _order(Store store) {
    // A closed store has no menu to show; the button is not offered, and
    // this keeps a stale tap from choosing it anyway.
    if (!store.isOpen) return;
    ref.read(activeStoreIdProvider.notifier).select(store.id);
    context.go(Routes.menu);
  }

  void _fitAll(List<StoreWithDistance> list, LatLng? me) {
    if (!_mapReady) return;
    final points = mapFocus([
      for (final item in list)
        if (item.store.hasLocation) LatLng(item.store.latitude, item.store.longitude),
    ], me);
    if (points.isEmpty) return;
    _fitted = true;
    if (points.length == 1) {
      _map.move(points.first, 15);
      return;
    }
    // Keep every pin clear of the search bar on top and the sheet below,
    // where a pin can neither be seen nor tapped.
    final screen = MediaQuery.sizeOf(context);
    final top = MediaQuery.paddingOf(context).top;
    _map.fitCamera(
      CameraFit.coordinates(
        coordinates: points,
        padding: EdgeInsets.fromLTRB(48, top + 96, 48, screen.height * StoresScreen.focusSheetSize + 24),
        maxZoom: 16,
      ),
    );
  }

  /// Fits the camera once both the map and the stores are there.
  void _initialFit() {
    if (_fitted || !_mapReady || !mounted) return;
    final stores = ref.read(sortedStoresProvider).valueOrNull;
    if (stores == null) return;
    _fitAll(stores, ref.read(userLocationProvider));
  }

  Future<void> _refresh() async {
    ref.invalidate(storesProvider);
    try {
      await ref.read(storesProvider.future);
    } on Object {
      // The list shows the error itself.
    }
  }

  Color _pinColor(BrandColors brand, Store store) {
    if (!store.isOpen) return brand.textTertiary;
    final busy = brand.busy(store.busyMeter);
    return busy == brand.mint ? brand.caramel : busy;
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

    ref
      ..listen(userLocationProvider, (_, next) {
        if (next != null) _fitAll(list, next);
      })
      // On a cold start the map is ready long before the stores arrive; the
      // fit in onMapReady then had nothing to fit and the camera stayed on
      // the default spot with no pins in view.
      ..listen(sortedStoresProvider, (previous, next) {
        if (!_fitted && next.hasValue) WidgetsBinding.instance.addPostFrameCallback((_) => _initialFit());
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
                  _initialFit();
                },
                onTap: (_, _) => _clearFocus(),
              ),
              children: [
                mapTiles(context),
                MarkerLayer(
                  markers: [
                    if (me != null) Marker(point: me, width: 24, height: 24, child: const UserDot()),
                    for (final item in located)
                      Marker(
                        key: ValueKey('pin-${item.store.id}'),
                        point: LatLng(item.store.latitude, item.store.longitude),
                        width: 48,
                        height: 58,
                        alignment: Alignment.topCenter,
                        // Opaque: the pin's transparent corners must not let
                        // the tap through to the map, whose own tap clears
                        // the selection again.
                        child: GestureDetector(
                          behavior: HitTestBehavior.opaque,
                          onTap: () => _focusFromMap(item.store),
                          child: StorePin(
                            color: _pinColor(brand, item.store),
                            highlighted: item.store.id == _focused || item.store.id == activeId,
                          ),
                        ),
                      ),
                  ],
                ),
                mapAttribution(),
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
            controller: _sheet,
            initialChildSize: 0.42,
            minChildSize: 0.2,
            maxChildSize: 0.88,
            snap: true,
            snapSizes: const [0.2, StoresScreen.focusSheetSize, 0.88],
            builder: (context, controller) {
              _list = controller;
              return Container(
                decoration: BoxDecoration(
                  color: brand.cream,
                  borderRadius: const BorderRadius.vertical(top: Radius.circular(28)),
                  boxShadow: brand.liftedShadow,
                ),
                // Pull down at the top of the list to ask again — e.g. right
                // after the barista started the shift.
                child: RefreshIndicator(
                  color: brand.caramel,
                  onRefresh: _refresh,
                  child: CustomScrollView(
                    controller: controller,
                    physics: const AlwaysScrollableScrollPhysics(),
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
                        skipError: true,
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
                                child: EmptyState(
                                  icon: Icons.search_off_rounded,
                                  title: l10n.storesEmpty,
                                  compact: true,
                                ),
                              )
                            : SliverPadding(
                                padding: const EdgeInsets.fromLTRB(16, 4, 16, 24),
                                sliver: SliverList.separated(
                                  itemCount: list.length,
                                  separatorBuilder: (_, _) => const SizedBox(height: 12),
                                  itemBuilder: (context, index) => _StoreRow(
                                    key: ValueKey(list[index].store.id),
                                    item: list[index],
                                    active: list[index].store.id == activeId,
                                    expanded: list[index].store.id == _focused,
                                    onFocus: _focus,
                                    onOrder: _order,
                                  ),
                                ),
                              ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}

/// A store in the sheet: tap to expand it (route, order); tap again to
/// order. A closed store expands too — to find it, or route to it — but
/// says it is closed where the order button would be.
class _StoreRow extends StatelessWidget {
  const _StoreRow({
    required this.item,
    required this.active,
    required this.expanded,
    required this.onFocus,
    required this.onOrder,
    super.key,
  });

  final StoreWithDistance item;
  final bool active;
  final bool expanded;
  final ValueChanged<Store> onFocus;
  final ValueChanged<Store> onOrder;

  @override
  Widget build(BuildContext context) {
    final l10n = AppLocalizations.of(context);
    final store = item.store;
    final open = store.isOpen;
    return Column(
      children: [
        StoreTile(
          item: item,
          dimmed: !open,
          selected: active || expanded,
          onTap: () => expanded && open ? onOrder(store) : onFocus(store),
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
                            onPressed: () => openDirections(store.latitude, store.longitude, label: store.name),
                            icon: const Icon(Icons.directions_rounded),
                            label: Text(l10n.buildRoute),
                          ),
                        ),
                      if (store.hasLocation) const SizedBox(width: 8),
                      Expanded(
                        child: open
                            ? FilledButton.icon(
                                onPressed: () => onOrder(store),
                                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
                                icon: const Icon(Icons.local_cafe_rounded),
                                label: Text(l10n.orderHere),
                              )
                            : FilledButton.icon(
                                onPressed: null,
                                style: FilledButton.styleFrom(minimumSize: const Size.fromHeight(50)),
                                icon: Icon(store.isInactive ? Icons.do_not_disturb_on_rounded : Icons.nightlight_round),
                                label: Text(l10n.storeClosedNow),
                              ),
                      ),
                    ],
                  ),
                )
              : const SizedBox(width: double.infinity),
        ),
      ],
    );
  }
}
