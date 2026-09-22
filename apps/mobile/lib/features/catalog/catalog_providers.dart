import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/location/location_service.dart';
import '../../core/network/api_error.dart';
import '../../core/providers.dart';
import '../../core/storage/app_prefs.dart';

/// A value that may come from the disk cache while the network is away.
class Cached<T> {
  const Cached(this.value, {this.stale = false});

  final T value;

  /// True when the network failed and this is the last saved copy.
  final bool stale;
}

/// Fetch-then-fallback helper: the network wins; the cache is only used
/// when the network fails, and failing without a cache is an error.
Future<Cached<T>> _networkFirst<T>({
  required Ref ref,
  required String cacheKey,
  required Future<T> Function() fetch,
  required Object? Function(T value) encode,
  required T Function(Object? json) decode,
}) async {
  final cache = ref.read(jsonCacheProvider);
  try {
    final value = await fetch();
    unawaited(cache.write(cacheKey, encode(value)));
    return Cached(value);
  } on Object catch (error) {
    final apiError = ApiError.from(error);
    if (!apiError.isNetwork) throw apiError;
    final raw = await cache.read(cacheKey);
    if (raw == null) throw apiError;
    try {
      return Cached(decode(raw), stale: true);
    } on Object {
      throw apiError;
    }
  }
}

/// A store with its distance from the customer, when both are known.
class StoreWithDistance {
  const StoreWithDistance(this.store, this.distanceMeters);

  final Store store;
  final double? distanceMeters;
}

/// All stores taking orders.
///
/// Fetched without coordinates on purpose: the API drops stores outside a
/// radius (and stores without coordinates) when given a point. Distances
/// are worked out here instead, from the device location.
final storesProvider = FutureProvider<Cached<List<Store>>>((ref) {
  final api = ref.watch(apiProvider);
  return _networkFirst<List<Store>>(
    ref: ref,
    cacheKey: 'stores',
    fetch: api.stores,
    encode: (stores) => [for (final s in stores) s.toJson()],
    decode: (json) => (json! as List).map((e) => Store.fromJson(e as Map<String, dynamic>)).toList(),
  );
});

/// Last known device position, if the customer has shared it.
class UserLocationController extends Notifier<LatLng?> {
  @override
  LatLng? build() {
    final service = ref.read(locationServiceProvider);
    // Without prompting: only use a permission the customer already gave.
    unawaited(_silentRefresh(service));
    return service.lastKnown;
  }

  Future<void> _silentRefresh(LocationService service) async {
    if (!await service.hasPermission()) return;
    final result = await service.locate(prompt: false);
    if (result.ok) state = result.position;
  }

  /// Asks for location (prompting if needed) and reports why when it cannot.
  Future<LocationResult> request() async {
    final result = await ref.read(locationServiceProvider).locate();
    if (result.ok) state = result.position;
    return result;
  }
}

final userLocationProvider = NotifierProvider<UserLocationController, LatLng?>(UserLocationController.new);

/// Stores ordered for picking: nearest first when we know where the
/// customer is, otherwise shortest wait first.
final sortedStoresProvider = Provider<AsyncValue<List<StoreWithDistance>>>((ref) {
  final stores = ref.watch(storesProvider);
  final here = ref.watch(userLocationProvider);
  return stores.whenData((cached) {
    final list = cached.value.map((store) {
      final distance = here != null && store.hasLocation
          ? LocationService.distanceMeters(here, LatLng(store.latitude, store.longitude))
          : null;
      return StoreWithDistance(store, distance);
    }).toList();
    list.sort((a, b) {
      final da = a.distanceMeters;
      final db = b.distanceMeters;
      if (da != null && db != null) return da.compareTo(db);
      if (da != null) return -1;
      if (db != null) return 1;
      return a.store.currentEtaSeconds.compareTo(b.store.currentEtaSeconds);
    });
    return list;
  });
});

final storeDetailProvider = FutureProvider.family<StoreDetail, String>((ref, idOrSlug) async {
  try {
    return await ref.watch(apiProvider).store(idOrSlug);
  } on Object catch (error) {
    throw ApiError.from(error);
  }
});

/// The store the customer is ordering from, resolved against the live list.
/// Falls back to the only store when there is exactly one — nothing to pick.
final activeStoreProvider = Provider<Store?>((ref) {
  final stores = ref.watch(storesProvider).valueOrNull?.value;
  if (stores == null || stores.isEmpty) return null;
  final id = ref.watch(activeStoreIdProvider);
  if (id != null) {
    for (final store in stores) {
      if (store.id == id) return store;
    }
  }
  return stores.length == 1 ? stores.first : null;
});

final menuProvider = FutureProvider.family<Cached<Menu>, String>((ref, storeId) {
  final api = ref.watch(apiProvider);
  return _networkFirst<Menu>(
    ref: ref,
    cacheKey: 'menu:$storeId',
    fetch: () => api.menu(storeId),
    encode: (menu) => menu.toJson(),
    decode: (json) => Menu.fromJson(json! as Map<String, dynamic>),
  );
});

/// Product details (variations and modifiers). Kept for the session: the
/// cart uses them to name the chosen options.
final productDetailProvider = FutureProvider.family<ProductDetail, String>((ref, idOrSlug) async {
  try {
    return await ref.watch(apiProvider).product(idOrSlug);
  } on Object catch (error) {
    throw ApiError.from(error);
  }
});

final pickupSlotsProvider = FutureProvider.autoDispose.family<List<PickupSlot>, String>((ref, storeId) async {
  try {
    return await ref.watch(apiProvider).pickupSlots(storeId);
  } on Object catch (error) {
    throw ApiError.from(error);
  }
});

final featureFlagsProvider = FutureProvider<FeatureFlags>((ref) async {
  final prefs = ref.watch(sharedPreferencesProvider);
  try {
    final flags = await ref.watch(apiProvider).features();
    unawaited(prefs.setBool('flags.delivery', flags.deliveryEnabled));
    unawaited(prefs.setBool('flags.cards', flags.agroprombankEnabled));
    return flags;
  } on Object {
    return FeatureFlags(
      deliveryEnabled: prefs.getBool('flags.delivery') ?? false,
      agroprombankEnabled: prefs.getBool('flags.cards') ?? false,
    );
  }
});
