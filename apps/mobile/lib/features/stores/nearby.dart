import 'dart:async';

import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';
import 'package:takeaway_api/takeaway_api.dart';

import '../../core/providers.dart';
import '../../shared/store_kinds.dart';
import '../catalog/catalog_providers.dart';

/// How far "near me" reaches on the stores map; [all] turns the mode off.
enum NearbyRadius {
  m500('500', 500),
  km1('1000', 1000),
  all('all', null);

  const NearbyRadius(this.key, this.meters);

  /// How the choice is saved on the device.
  final String key;
  final double? meters;

  /// The radius offered when this one has no stores in it.
  NearbyRadius get wider => switch (this) {
    m500 => km1,
    km1 || all => all,
  };

  static NearbyRadius fromKey(String? key) => values.firstWhere((r) => r.key == key, orElse: () => all);
}

/// The stores filter by what they sell; a store selling both passes either.
enum KindFilter {
  all(null),
  coffee(StoreKind.coffee),
  food(StoreKind.food);

  const KindFilter(this.kind);

  final StoreKind? kind;

  bool matches(Store store) => kind == null || storeKinds(store).contains(kind);
}

/// Whether a store is inside [meters] of the customer. Null [meters] (no
/// radius) passes every store; with a radius, a store whose distance is
/// unknown — no coordinates — is left out.
bool isWithin(StoreWithDistance item, double? meters) {
  if (meters == null) return true;
  final distance = item.distanceMeters;
  return distance != null && distance <= meters;
}

/// The box around a circle of [meters] around [center], for fitting the
/// camera to the radius.
LatLngBounds radiusBounds(LatLng center, double meters) {
  const distance = Distance();
  return LatLngBounds.fromPoints([
    for (final bearing in const [0, 90, 180, 270]) distance.offset(center, meters, bearing),
  ]);
}

/// The radius the customer chose on the stores map, kept on the device so
/// the map opens the way they left it.
class NearbyRadiusController extends Notifier<NearbyRadius> {
  static const _key = 'stores.radius';

  NearbyRadius? _lastNearby;

  @override
  NearbyRadius build() => NearbyRadius.fromKey(ref.watch(sharedPreferencesProvider).getString(_key));

  /// The radius "Near me" turns on: the current one, else the last one
  /// chosen, else 1 km.
  NearbyRadius get nearby {
    if (state != NearbyRadius.all) return state;
    return _lastNearby ?? NearbyRadius.km1;
  }

  void select(NearbyRadius radius) {
    if (state != NearbyRadius.all) _lastNearby = state;
    if (radius != NearbyRadius.all) _lastNearby = radius;
    if (state == radius) return;
    state = radius;
    unawaited(ref.read(sharedPreferencesProvider).setString(_key, radius.key));
  }
}

final nearbyRadiusProvider = NotifierProvider<NearbyRadiusController, NearbyRadius>(NearbyRadiusController.new);
