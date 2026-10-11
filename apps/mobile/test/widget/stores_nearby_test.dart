import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:latlong2/latlong.dart';
import 'package:takeaway_mobile/core/location/location_service.dart';
import 'package:takeaway_mobile/core/providers.dart';
import 'package:takeaway_mobile/core/theme/tokens.dart';
import 'package:takeaway_mobile/features/stores/nearby.dart';
import 'package:takeaway_mobile/features/stores/store_widgets.dart';
import 'package:takeaway_mobile/shared/store_kinds.dart';
import 'package:takeaway_mobile/shared/widgets/store_map.dart';

import '../helpers/fake_api.dart';
import '../helpers/fake_location.dart';
import '../helpers/harness.dart';

void main() {
  const me = LatLng(46.84, 29.63);

  /// Degrees of latitude for [meters] due north, on Geolocator's sphere.
  double north(double meters) => meters / 6378137 * 180 / 3.141592653589793;

  Map<String, dynamic> storeAt(String id, String name, double meters, List<String> kinds, {String status = 'OPEN'}) => {
    ...FakeApi.storeJson,
    'id': id,
    'slug': id,
    'name': name,
    'latitude': me.latitude + north(meters),
    'longitude': me.longitude,
    'kinds': kinds,
    'status': status,
  };

  // st_1, the default store, has no coordinates and names no kinds.
  FakeApi api() => FakeApi()
    ..moreStores = [
      storeAt('st_far', 'Кафе на вокзале', 3000, ['COFFEE', 'FOOD']),
      storeAt('st_mid', 'Бургерная', 800, ['FOOD']),
      storeAt('st_near', 'Кофейня у дома', 300, ['COFFEE']),
    ];

  /// The harness sizes the surface to a phone but leaves MediaQuery at the
  /// test default (800 x 600); a snack with a long action lays out against
  /// the latter, so the view matches the surface here.
  void phoneView(WidgetTester tester) {
    tester.view
      ..physicalSize = const Size(412, 915)
      ..devicePixelRatio = 1;
    addTearDown(tester.view.reset);
  }

  Future<Harness> open(WidgetTester tester, FakeLocationService location, {Map<String, Object> saved = const {}}) {
    phoneView(tester);
    return pumpApp(
      tester,
      api: api(),
      activeStoreId: null,
      saved: saved,
      overrides: [locationServiceProvider.overrideWithValue(location)],
    );
  }

  /// The stores in the sheet, top to bottom. The sheet is pulled all the way
  /// up to build every row, then put back so the chips over the map show.
  Future<List<String>> listed(WidgetTester tester) async {
    final sheet = tester.widget<DraggableScrollableSheet>(find.byType(DraggableScrollableSheet)).controller!;
    sheet.jumpTo(0.88);
    await tester.pump();
    final ids = tester.widgetList<StoreTile>(find.byType(StoreTile)).map((t) => t.item.store.id).toList();
    sheet.jumpTo(0.42);
    await tester.pump();
    return ids;
  }

  List<String> pinned(WidgetTester tester) => [
    for (final marker in tester.widget<MarkerLayer>(find.byType(MarkerLayer)).markers)
      if (marker.key case ValueKey<String>(:final value) when value.startsWith('pin-')) value.substring(4),
  ];

  bool selected(WidgetTester tester, String chip) => tester.widget<ChoiceChip>(find.byKey(ValueKey(chip))).selected;

  Future<void> tapChip(WidgetTester tester, String chip) async {
    await tester.tap(find.byKey(ValueKey(chip)));
    await settle(tester);
  }

  testWidgets('"near me" centres on the customer, draws the radius and keeps only the stores inside it', (
    tester,
  ) async {
    final h = await open(tester, FakeLocationService(position: me));

    expect(await listed(tester), containsAll(['st_near', 'st_mid', 'st_far', 'st_1']), reason: 'off until asked for');
    expect(selected(tester, 'radius-all'), isTrue);
    expect(find.byType(CircleLayer), findsNothing);

    await tapChip(tester, 'near-me');
    expect(selected(tester, 'near-me'), isTrue);
    expect(selected(tester, 'radius-1000'), isTrue, reason: '1 km the first time');
    expect(await listed(tester), ['st_near', 'st_mid'], reason: 'nearest first');
    expect(pinned(tester), unorderedEquals(['st_near', 'st_mid']));
    expect(find.text('300 м от вас'), findsOneWidget);
    final circle = tester.widget<CircleLayer>(find.byType(CircleLayer)).circles.single;
    expect((circle.point, circle.radius, circle.useRadiusInMeter), (me, 1000, true));
    final camera = tester.widget<FlutterMap>(find.byType(FlutterMap)).mapController!.camera;
    expect(camera.visibleBounds.containsBounds(radiusBounds(me, 1000)), isTrue, reason: 'zoomed to fit the circle');
    expect(camera.zoom, greaterThan(12));

    await tapChip(tester, 'radius-500');
    expect(await listed(tester), ['st_near']);
    expect(tester.widget<CircleLayer>(find.byType(CircleLayer)).circles.single.radius, 500);
    expect(h.container.read(sharedPreferencesProvider).getString('stores.radius'), '500', reason: 'remembered');

    await tapChip(tester, 'radius-all');
    expect(find.byType(CircleLayer), findsNothing);
    expect(await listed(tester), hasLength(4));
    await h.unmount(tester);
  });

  testWidgets('an empty radius offers the next one up, and the kind filter works with the radius', (tester) async {
    final h = await open(tester, FakeLocationService(position: me), saved: {'stores.radius': '500'});

    expect(selected(tester, 'radius-500'), isTrue, reason: 'opens with the radius chosen last time');
    expect(await listed(tester), ['st_near']);

    await tapChip(tester, 'kind-food');
    expect(await listed(tester), isEmpty);
    expect(find.text('В радиусе 500 м ничего нет'), findsOneWidget);
    await tester.tap(find.text('Показать 1 км'));
    await settle(tester);
    expect(selected(tester, 'radius-1000'), isTrue);
    expect(await listed(tester), ['st_mid']);
    expect(pinned(tester), ['st_mid']);

    await tester.enterText(find.byType(TextField), 'вокзал');
    await settle(tester);
    expect(find.text('В радиусе 1 км ничего нет'), findsOneWidget);
    await tester.tap(find.text('Показать все точки'));
    await settle(tester);
    expect(selected(tester, 'radius-all'), isTrue);
    expect(await listed(tester), ['st_far'], reason: 'sells food too');

    await tester.enterText(find.byType(TextField), '');
    await tapChip(tester, 'kind-coffee');
    expect(
      await listed(tester),
      unorderedEquals(['st_near', 'st_far', 'st_1']),
      reason: 'a store naming no kinds is coffee',
    );
    await h.unmount(tester);
  });

  testWidgets('without location access it explains, offers the settings and keeps the map as it was', (tester) async {
    final location = FakeLocationService(position: me, allowed: false);
    final h = await open(tester, location, saved: {'stores.radius': '500'});

    expect(selected(tester, 'radius-all'), isTrue, reason: 'no radius without knowing where the customer is');
    expect(await listed(tester), hasLength(4));

    await tapChip(tester, 'radius-500');
    expect(location.requests, 1, reason: 'asks for access');
    expect(find.text('Доступ к геолокации выключен. Разрешите его в настройках, чтобы видеть точки рядом.'), findsOne);
    expect(await listed(tester), hasLength(4));
    expect(find.byType(CircleLayer), findsNothing);
    expect(selected(tester, 'radius-all'), isTrue);

    await tester.tap(find.text('Открыть настройки'));
    await settle(tester);
    expect(location.settingsOpened, 1);

    // Allowed in the settings: the next tap works.
    location.allowed = true;
    await tapChip(tester, 'near-me');
    expect(selected(tester, 'radius-500'), isTrue, reason: 'the radius chosen last time');
    expect(await listed(tester), ['st_near']);
    await settle(tester, const Duration(seconds: 6));
    await h.unmount(tester);
  });

  testWidgets('pins show what a store sells, and a closed one stays grey', (tester) async {
    final stores = api();
    stores.moreStores.add(storeAt('st_shut', 'Закрытая шаурма', 500, ['FOOD'], status: 'CLOSED'));
    final h = await pumpApp(
      tester,
      api: stores,
      activeStoreId: null,
      overrides: [locationServiceProvider.overrideWithValue(FakeLocationService(position: me))],
    );

    StorePin pin(String id) =>
        tester.widget<StorePin>(find.descendant(of: find.byKey(ValueKey('pin-$id')), matching: find.byType(StorePin)));
    Finder icon(String id, IconData data) =>
        find.descendant(of: find.byKey(ValueKey('pin-$id')), matching: find.byIcon(data));

    expect(pin('st_near').kinds, {StoreKind.coffee});
    expect(icon('st_near', Icons.local_cafe_rounded), findsOneWidget);
    expect(icon('st_near', Icons.restaurant_rounded), findsNothing);

    expect(pin('st_mid').kinds, {StoreKind.food});
    expect(icon('st_mid', Icons.restaurant_rounded), findsOneWidget);
    expect(icon('st_mid', Icons.local_cafe_rounded), findsNothing);

    expect(pin('st_far').kinds, {StoreKind.coffee, StoreKind.food});
    expect(icon('st_far', Icons.local_cafe_rounded), findsOneWidget);
    expect(icon('st_far', Icons.restaurant_rounded), findsOneWidget, reason: 'the food badge');

    expect(pin('st_shut').color, BrandColors.light.textTertiary);
    expect(icon('st_shut', Icons.restaurant_rounded), findsOneWidget);
    await h.unmount(tester);
  });

  test('the fake reports a refusal the way the real service does', () async {
    final location = FakeLocationService(allowed: false, refusal: LocationStatus.deniedForever);
    expect((await location.locate()).status, LocationStatus.deniedForever);
  });
}
