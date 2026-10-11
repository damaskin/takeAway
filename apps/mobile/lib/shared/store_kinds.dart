import 'package:flutter/material.dart';
import 'package:takeaway_api/takeaway_api.dart';

/// What a store sells, as its map pin and the stores filter show it.
enum StoreKind {
  coffee('COFFEE', Icons.local_cafe_rounded),
  food('FOOD', Icons.restaurant_rounded);

  const StoreKind(this.wire, this.icon);

  /// The value in the API's `kinds`.
  final String wire;
  final IconData icon;
}

/// The kinds [store] sells. Entries the app does not know are ignored; a
/// store that names none — or an API that predates kinds — is a coffee shop,
/// as every store was before.
Set<StoreKind> storeKinds(Store store) {
  final kinds = {
    for (final raw in store.kinds ?? const <String>[])
      for (final kind in StoreKind.values)
        if (raw.trim().toUpperCase() == kind.wire) kind,
  };
  return kinds.isEmpty ? const {StoreKind.coffee} : kinds;
}

/// The pin's icon for what a store sells: a cup, a fork and knife, or — for a
/// store selling both — the cup with the fork and knife as a small badge.
({IconData icon, IconData? badge}) storePinIcons(Set<StoreKind> kinds) {
  final coffee = kinds.contains(StoreKind.coffee);
  final food = kinds.contains(StoreKind.food);
  if (food && !coffee) return (icon: StoreKind.food.icon, badge: null);
  return (icon: StoreKind.coffee.icon, badge: food ? StoreKind.food.icon : null);
}
