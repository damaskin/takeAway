import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:shared_preferences/shared_preferences.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/core/providers.dart';
import 'package:takeaway_mobile/features/catalog/catalog_providers.dart';
import 'package:takeaway_mobile/features/stores/nearby.dart';
import 'package:takeaway_mobile/shared/store_kinds.dart';

import '../helpers/fake_api.dart';

Store store({Object? kinds = const <String>[], bool withKinds = true}) {
  final json = {...FakeApi.storeJson};
  if (withKinds) json['kinds'] = kinds;
  return Store.fromJson(json);
}

void main() {
  group('what a store sells', () {
    test('a store that names nothing, or an API without kinds, is a coffee shop', () {
      expect(storeKinds(store(withKinds: false)), {StoreKind.coffee});
      expect(storeKinds(store()), {StoreKind.coffee});
      expect(storeKinds(store(kinds: ['TEA'])), {StoreKind.coffee}, reason: 'unknown kinds are ignored');
    });

    test('food, coffee, or both; case and stray values do not matter', () {
      expect(storeKinds(store(kinds: ['FOOD'])), {StoreKind.food});
      expect(storeKinds(store(kinds: ['coffee', ' FOOD ', 'TEA', 7])), {StoreKind.coffee, StoreKind.food});
    });

    test('the pin shows a cup, a fork and knife, or the cup with a food badge', () {
      expect(storePinIcons({StoreKind.coffee}), (icon: Icons.local_cafe_rounded, badge: null));
      expect(storePinIcons({StoreKind.food}), (icon: Icons.restaurant_rounded, badge: null));
      expect(storePinIcons({StoreKind.coffee, StoreKind.food}), (
        icon: Icons.local_cafe_rounded,
        badge: Icons.restaurant_rounded,
      ));
    });

    test('the kind filter lets a store selling both through either way', () {
      final coffee = store(kinds: ['COFFEE']);
      final food = store(kinds: ['FOOD']);
      final both = store(kinds: ['COFFEE', 'FOOD']);
      expect([coffee, food, both].where(KindFilter.all.matches), hasLength(3));
      expect([coffee, food, both].where(KindFilter.coffee.matches), [coffee, both]);
      expect([coffee, food, both].where(KindFilter.food.matches), [food, both]);
      expect(KindFilter.coffee.matches(store(withKinds: false)), isTrue);
    });
  });

  group('radius', () {
    StoreWithDistance at(double? meters) => StoreWithDistance(store(), meters);

    test('keeps the stores inside it, edge included, and drops the ones with no known distance', () {
      expect(isWithin(at(350), 500), isTrue);
      expect(isWithin(at(500), 500), isTrue);
      expect(isWithin(at(501), 500), isFalse);
      expect(isWithin(at(null), 500), isFalse, reason: 'a store without coordinates is not "near"');
    });

    test('no radius keeps every store, located or not', () {
      expect(isWithin(at(12000), null), isTrue);
      expect(isWithin(at(null), null), isTrue);
    });

    test('an empty radius offers the next one up, then all', () {
      expect(NearbyRadius.m500.wider, NearbyRadius.km1);
      expect(NearbyRadius.km1.wider, NearbyRadius.all);
      expect(NearbyRadius.all.wider, NearbyRadius.all);
    });

    test('the camera box holds the whole circle', () {
      const me = LatLng(46.84, 29.63);
      final box = radiusBounds(me, 1000);
      const distance = Distance();
      expect(distance.as(LengthUnit.Meter, me, LatLng(box.north, me.longitude)), closeTo(1000, 5));
      expect(distance.as(LengthUnit.Meter, me, LatLng(me.latitude, box.east)), closeTo(1000, 5));
      expect(box.contains(me), isTrue);
    });
  });

  group('remembered radius', () {
    Future<ProviderContainer> container([Map<String, Object> saved = const {}]) async {
      SharedPreferences.setMockInitialValues(saved);
      final prefs = await SharedPreferences.getInstance();
      final container = ProviderContainer(overrides: [sharedPreferencesProvider.overrideWithValue(prefs)]);
      addTearDown(container.dispose);
      return container;
    }

    test('opens the way it was left, and is off the first time', () async {
      expect((await container()).read(nearbyRadiusProvider), NearbyRadius.all);
      expect((await container({'stores.radius': '500'})).read(nearbyRadiusProvider), NearbyRadius.m500);
      expect((await container({'stores.radius': 'nonsense'})).read(nearbyRadiusProvider), NearbyRadius.all);
    });

    test('a choice is saved on the device', () async {
      final c = await container();
      c.read(nearbyRadiusProvider.notifier).select(NearbyRadius.m500);
      expect(c.read(nearbyRadiusProvider), NearbyRadius.m500);
      expect(c.read(sharedPreferencesProvider).getString('stores.radius'), '500');
    });

    test('"near me" turns on 1 km the first time, then the radius chosen last', () async {
      final c = await container();
      final radius = c.read(nearbyRadiusProvider.notifier);
      expect(radius.nearby, NearbyRadius.km1);

      radius
        ..select(NearbyRadius.m500)
        ..select(NearbyRadius.all);
      expect(radius.nearby, NearbyRadius.m500);
    });
  });
}
