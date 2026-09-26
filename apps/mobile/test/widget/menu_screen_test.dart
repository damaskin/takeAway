import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/core/storage/app_prefs.dart';
import 'package:takeaway_mobile/features/menu/menu_widgets.dart';
import 'package:takeaway_mobile/features/stores/store_widgets.dart';

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
    ];

  testWidgets('first launch asks for a store and only lets an active one be picked', (tester) async {
    final h = await pumpApp(tester, api: withClosedStore(), activeStoreId: null);

    expect(find.text('Где заберёте заказ?'), findsOneWidget);
    expect(find.byType(BusinessPlate), findsNothing, reason: 'no menu before a store is chosen');
    expect(find.text('Сейчас не принимают заказы'), findsOneWidget);

    // The closed store is listed but does nothing when tapped.
    await tester.tap(find.text('NoName — Балка'));
    await settle(tester);
    expect(find.byType(BusinessPlate), findsNothing);
    expect(find.text('Где заберёте заказ?'), findsOneWidget);

    await tester.tap(find.text('NoName — центр'));
    await settle(tester);
    expect(find.byType(BusinessPlate), findsOneWidget);
    expect(find.text('Латте'), findsOneWidget);
    expect(h.container.read(activeStoreIdProvider), 'st_1');

    await h.unmount(tester);
  });

  testWidgets('a single store still has to be picked on first launch', (tester) async {
    final h = await pumpApp(tester, activeStoreId: null);

    expect(find.text('Где заберёте заказ?'), findsOneWidget);
    await tester.tap(find.text('NoName — центр'));
    await settle(tester);
    expect(find.byType(BusinessPlate), findsOneWidget);

    await h.unmount(tester);
  });

  testWidgets('store cards show the business logo, or the takeAway cup without one', (tester) async {
    final api = FakeApi()
      ..moreStores = [
        {...FakeApi.storeJson, 'id': 'st_2', 'name': 'С логотипом', 'logoUrl': 'https://cdn.takeaway.md/logo.png'},
      ];
    final h = await pumpApp(tester, api: api, activeStoreId: null);

    expect(find.byType(StoreLogo), findsNWidgets(2));
    expect(
      find.descendant(
        of: find.ancestor(of: find.text('С логотипом'), matching: find.byType(StoreTile)),
        matching: find.byWidgetPredicate((w) => w.runtimeType.toString() == 'CachedNetworkImage'),
      ),
      findsOneWidget,
    );

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
