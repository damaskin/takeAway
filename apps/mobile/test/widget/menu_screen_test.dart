import 'dart:typed_data';

import 'package:cached_network_image/cached_network_image.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/core/storage/app_prefs.dart';
import 'package:takeaway_mobile/features/menu/menu_widgets.dart';
import 'package:takeaway_mobile/features/stores/store_widgets.dart';
import 'package:takeaway_mobile/features/stores/stores_screen.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

void main() {
  FakeApi withClosedStore() => FakeApi()
    ..moreStores = [
      {
        ...FakeApi.storeJson,
        'id': 'st_2',
        'slug': 'noname-balka',
        'name': 'NoName — Балка',
        'status': 'CLOSED',
        'openNow': false,
      },
      {
        ...FakeApi.storeJson,
        'id': 'st_3',
        'slug': 'noname-kirova',
        'name': 'NoName — Кирова',
        'acceptingOrders': false,
      },
    ];

  testWidgets('without a chosen store the app opens on the stores, and only an open one can be ordered from', (
    tester,
  ) async {
    final h = await pumpApp(tester, api: withClosedStore(), activeStoreId: null);

    expect(find.byType(StoresScreen), findsOneWidget, reason: 'where to order comes before what');
    // Pull the list all the way up to see every store.
    tester.widget<DraggableScrollableSheet>(find.byType(DraggableScrollableSheet)).controller!.jumpTo(0.88);
    await settle(tester);
    expect(find.byType(BusinessPlate), findsNothing);

    // Closed stores are listed after the open one, greyed out.
    final names = tester.widgetList<StoreTile>(find.byType(StoreTile)).map((t) => t.item.store.name).toList();
    expect(names.first, 'NoName — центр');
    final closed = tester.widget<StoreTile>(
      find.ancestor(of: find.text('NoName — Балка'), matching: find.byType(StoreTile)),
    );
    expect(closed.dimmed, isTrue);

    // A closed store opens up to be found, but offers no ordering.
    await tester.tap(find.text('NoName — Балка'));
    await settle(tester);
    expect(find.text('Заказать здесь'), findsNothing);
    expect(find.text('Сейчас закрыто'), findsOneWidget);
    await tester.tap(find.text('NoName — Балка'));
    await settle(tester);
    expect(h.container.read(activeStoreIdProvider), isNull, reason: 'a second tap does not order from it either');

    // Nor one that is switched on but has no shift started.
    await tester.tap(find.text('NoName — Кирова'));
    await settle(tester);
    expect(find.text('Заказать здесь'), findsNothing);

    await tester.tap(find.text('NoName — центр'));
    await settle(tester);
    await tester.tap(find.text('Заказать здесь'));
    await settle(tester);
    expect(find.byType(BusinessPlate), findsOneWidget);
    expect(find.text('Латте'), findsOneWidget);
    expect(h.container.read(activeStoreIdProvider), 'st_1');

    await h.unmount(tester);
  });

  testWidgets('the menu tab without a store sends the customer to the stores', (tester) async {
    final h = await pumpApp(tester, activeStoreId: null);

    await tester.tap(find.text('Меню'));
    await settle(tester);
    expect(find.byType(NoStoreState), findsOneWidget);
    expect(find.byType(StorePickerList), findsNothing, reason: 'stores are picked on their own tab');

    await tester.tap(find.text('Выбрать точку'));
    await settle(tester);
    expect(find.byType(StoresScreen), findsOneWidget);

    await h.unmount(tester);
  });

  testWidgets('first launch goes from the intro to the stores', (tester) async {
    final h = await pumpApp(tester, onboarded: false, activeStoreId: null);

    expect(find.byType(StoresScreen), findsNothing);
    await tester.tap(find.text('Пропустить'));
    await settle(tester);
    expect(find.byType(StoresScreen), findsOneWidget);

    await h.unmount(tester);
  });

  test('the app opens on the intro, then the stores, then the menu', () {
    expect(initialLocation(onboarded: false, hasStore: false), Routes.welcome);
    expect(initialLocation(onboarded: false, hasStore: true), Routes.welcome);
    expect(initialLocation(onboarded: true, hasStore: false), Routes.stores);
    expect(initialLocation(onboarded: true, hasStore: true), Routes.menu);
  });

  testWidgets('tapping a pin raises the list with that store on top', (tester) async {
    final api = FakeApi()
      ..moreStores = [
        for (var i = 2; i <= 6; i++)
          {
            ...FakeApi.storeJson,
            'id': 'st_$i',
            'slug': 'noname-$i',
            'name': 'NoName — точка $i',
            'latitude': 46.84 + i / 100,
            'longitude': 29.63,
          },
      ];
    final h = await pumpApp(tester, api: api, activeStoreId: null);

    // Shrink the sheet so the pin is not under it.
    final sheet = tester.widget<DraggableScrollableSheet>(find.byType(DraggableScrollableSheet));
    sheet.controller!.jumpTo(0.2);
    await settle(tester);

    await tester.tap(find.byKey(const ValueKey('pin-st_6')));
    await settle(tester);

    expect(sheet.controller!.size, closeTo(StoresScreen.focusSheetSize, 0.01));
    final first = tester.widgetList<StoreTile>(find.byType(StoreTile)).first;
    expect(first.item.store.id, 'st_6', reason: 'the tapped store is lifted to the top of the list');
    expect(first.selected, isTrue);
    expect(find.text('Заказать здесь'), findsOneWidget, reason: 'and expanded, ready to order');

    await h.unmount(tester);
  });

  testWidgets('store cards show the whole business logo on a light tile, or a quiet storefront without one', (
    tester,
  ) async {
    final api = FakeApi()
      ..moreStores = [
        {...FakeApi.storeJson, 'id': 'st_2', 'name': 'С логотипом', 'logoUrl': 'https://cdn.takeaway.md/logo.png'},
      ];
    final h = await pumpApp(tester, api: api, activeStoreId: null);

    Finder inTile(String name, Finder matching) => find.descendant(
      of: find.ancestor(of: find.text(name), matching: find.byType(StoreTile)),
      matching: matching,
    );

    final image = inTile('С логотипом', find.byType(CachedNetworkImage));
    expect(image, findsOneWidget);
    expect(tester.getSize(image), tester.getSize(inTile('С логотипом', find.byType(StoreLogo))));
    // Built as it is once the logo loads: fitted whole, with a margin, on white.
    final cached = tester.widget<CachedNetworkImage>(image);
    final tile = cached.imageBuilder!(tester.element(image), MemoryImage(Uint8List(0))) as DecoratedBox;
    expect((tile.decoration as BoxDecoration).color, StoreLogo.tileColor);
    final logo = (tile.child! as Padding).child! as Image;
    expect(logo.fit, BoxFit.contain, reason: 'a wide wordmark is not cropped');
    expect(inTile('NoName — центр', find.byIcon(Icons.storefront_rounded)), findsOneWidget);

    await h.unmount(tester);
  });

  testWidgets('stores come before the menu in the tab bar', (tester) async {
    final h = await pumpApp(tester);

    final labels = tester
        .widgetList<NavigationDestination>(find.byType(NavigationDestination))
        .map((d) => d.label)
        .toList();
    expect(labels, ['Точки', 'Меню', 'Заказы', 'Профиль']);
    // The app still opens on the menu.
    expect(find.byType(BusinessPlate), findsOneWidget);

    await h.unmount(tester);
  });

  testWidgets('the menu header puts the business name on its own plate', (tester) async {
    final h = await pumpApp(tester);

    final plate = find.byType(BusinessPlate);
    expect(find.descendant(of: plate, matching: find.text('NoName Coffee')), findsOneWidget);
    expect(find.descendant(of: plate, matching: find.textContaining('NoName — центр')), findsOneWidget);

    await tester.tap(plate);
    await settle(tester);
    expect(find.text('Где заберёте заказ?'), findsOneWidget, reason: 'tapping the plate changes the store');

    await h.unmount(tester);
  });
}
