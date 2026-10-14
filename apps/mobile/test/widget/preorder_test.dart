import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/core/format/time.dart';
import 'package:takeaway_mobile/core/storage/app_prefs.dart';
import 'package:takeaway_mobile/features/catalog/catalog_providers.dart';
import 'package:takeaway_mobile/features/checkout/checkout_sections.dart';
import 'package:takeaway_mobile/features/menu/menu_widgets.dart';
import 'package:takeaway_mobile/features/stores/store_widgets.dart';
import 'package:takeaway_mobile/shared/store_hours.dart';
import 'package:takeaway_mobile/shared/widgets/chips.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

/// The 2026-10-14 kitchen policy, customer side: ordering ahead while a
/// store is closed for an order now, and what the order screen says while
/// the customer waits.
void main() {
  Future<void> openCheckout(WidgetTester tester) async {
    await tester.tap(find.textContaining('позици'));
    await settle(tester);
    await tester.tap(find.textContaining('К оформлению'));
    await settle(tester);
  }

  Future<void> openOrder(WidgetTester tester, Harness h) async {
    unawaited(h.container.read(routerProvider).push(Routes.order('ord_1')));
    await settle(tester);
  }

  const held = {'state': 'HELD', 'amountCents': 2000, 'cardMask': null, 'paidAt': null};

  testWidgets('a store closed for the night keeps its menu and takes a pre-order for the morning', (tester) async {
    final opens = DateTime.now().add(const Duration(hours: 7));
    final api = FakeApi(flags: const FeatureFlags(agroprombankEnabled: true))
      ..boundCards = [FakeApi.card()]
      ..storeOpenNow = false
      ..storeExtra = {
        'acceptingOrders': true,
        'asapBlockedReason': 'OUTSIDE_HOURS',
        'opensAt': opens.toUtc().toIso8601String(),
      }
      ..seedCart(FakeApi.croissant());
    final h = await pumpApp(tester, api: api);

    expect(find.byType(StoreClosedState), findsNothing, reason: 'the store takes orders for later');
    expect(find.text('Латте'), findsOneWidget);
    expect(find.byType(EtaChip), findsNothing, reason: 'no wait promised while it is closed');
    final hours = storeHoursText(tester.element(find.byType(BusinessPlate)), h.container.read(activeStoreProvider)!);
    expect(hours, startsWith('Сейчас закрыто · откроется '));
    expect(hours, endsWith(' · можно заказать ко времени'));
    expect(find.text(hours!), findsOneWidget);

    await openCheckout(tester);
    expect(find.text('Оформление'), findsOneWidget);
    // «As soon as possible» is off with the reason, and a time later is on.
    expect(find.textContaining('Точка откроется'), findsOneWidget);
    expect(find.byType(SlotPicker), findsOneWidget);
    expect(api.slotCartIds, contains('cart_1'), reason: 'the windows are fitted to this cart');

    final slots = await api.pickupSlots('st_1');
    final first = slots.first.startsAt;
    expect(find.text(calendarDaysBetween(DateTime.now(), first) == 0 ? 'Сегодня' : 'Завтра'), findsOneWidget);

    await tester.tap(find.text('Как можно скорее'));
    await settle(tester);
    expect(find.byType(SlotPicker), findsOneWidget, reason: 'tapping the switched-off option changes nothing');

    await tester.tap(find.textContaining(formatClock(tester.element(find.byType(SlotPicker)), first)).first);
    await settle(tester);
    await tester.tap(find.textContaining('Оплатить'));
    await settle(tester, const Duration(seconds: 2));

    final order = api.created.single;
    expect(order.pickupMode, PickupMode.scheduled);
    expect(order.pickupAt, first);
    await h.unmount(tester);
  });

  testWidgets('the stores list offers a store open for pre-orders, after the open ones, with its opening time', (
    tester,
  ) async {
    final opens = DateTime.now().add(const Duration(hours: 7));
    final api = FakeApi()
      ..moreStores = [
        {
          ...FakeApi.storeJson,
          'id': 'st_2',
          'slug': 'noname-balka',
          'name': 'NoName — Балка',
          'openNow': false,
          'acceptingOrders': true,
          'asapBlockedReason': 'OUTSIDE_HOURS',
          'opensAt': opens.toUtc().toIso8601String(),
        },
        {
          ...FakeApi.storeJson,
          'id': 'st_3',
          'slug': 'noname-kirova',
          'name': 'NoName — Кирова',
          'acceptingOrders': false,
        },
      ];
    final h = await pumpApp(tester, api: api, activeStoreId: null);
    tester.widget<DraggableScrollableSheet>(find.byType(DraggableScrollableSheet)).controller!.jumpTo(0.88);
    await settle(tester);

    final names = tester.widgetList<StoreTile>(find.byType(StoreTile)).map((t) => t.item.store.name).toList();
    expect(names, ['NoName — центр', 'NoName — Балка', 'NoName — Кирова']);
    final later = tester.widget<StoreTile>(
      find.ancestor(of: find.text('NoName — Балка'), matching: find.byType(StoreTile)),
    );
    expect(later.dimmed, isFalse);
    expect(find.textContaining('Сейчас закрыто · откроется '), findsOneWidget);

    await tester.tap(find.text('NoName — Балка'));
    await settle(tester);
    await tester.tap(find.text('Заказать здесь'));
    await settle(tester);
    expect(h.container.read(activeStoreIdProvider), 'st_2');
    expect(find.byType(StoreClosedState), findsNothing);
    expect(find.text('Латте'), findsOneWidget);
    await h.unmount(tester);
  });

  testWidgets('a store taking no orders at all still refuses checkout', (tester) async {
    final api = FakeApi(flags: const FeatureFlags(agroprombankEnabled: true))
      ..boundCards = [FakeApi.card()]
      ..storeOpenNow = false
      ..storeExtra = {'acceptingOrders': false}
      ..seedCart(FakeApi.croissant());
    final h = await pumpApp(tester, api: api);
    expect(find.byType(StoreClosedState), findsOneWidget);
    await h.unmount(tester);
  });

  testWidgets('«as soon as possible» refused at payment switches to a time later', (tester) async {
    final api = FakeApi(flags: const FeatureFlags(agroprombankEnabled: true))
      ..boundCards = [FakeApi.card()]
      ..storeExtra = {'acceptingOrders': true}
      ..orderRefusal = {'code': 'ASAP_UNAVAILABLE', 'reason': 'QUEUE_FULL', 'opensAt': null}
      ..seedCart(FakeApi.croissant());
    final h = await pumpApp(tester, api: api);
    await openCheckout(tester);
    expect(find.byType(SlotPicker), findsNothing);

    await tester.tap(find.textContaining('Оплатить'));
    await settle(tester, const Duration(seconds: 2));

    expect(api.created, isEmpty);
    expect(find.text('На сейчас заказ уже не принять — выберите, к какому времени приготовить'), findsOneWidget);
    expect(find.byType(SlotPicker), findsOneWidget);
    await h.unmount(tester);
  });

  testWidgets('a pre-order placed at night waits for the store to open, counted in hours', (tester) async {
    final api = FakeApi()
      ..storeOpenNow = false
      ..storeExtra = {'acceptingOrders': true, 'asapBlockedReason': 'OUTSIDE_HOURS'}
      ..currentOrder = FakeApi.sampleOrder(
        payment: held,
        pickupMode: 'SCHEDULED',
        pickupAt: DateTime.now().add(const Duration(hours: 8)),
      );
    final h = await pumpApp(tester, api: api);
    await openOrder(tester, h);

    expect(find.text('Точка подтвердит предзаказ, когда откроется'), findsOneWidget);
    expect(find.textContaining(RegExp(r'^[78]:\d\d:\d\d$')), findsOneWidget);
    await h.unmount(tester);
  });

  testWidgets('an order on the board waits for the store to confirm it', (tester) async {
    final api = FakeApi()
      ..storeExtra = {'acceptingOrders': true}
      ..currentOrder = FakeApi.sampleOrder(payment: held);
    final h = await pumpApp(tester, api: api);
    await openOrder(tester, h);

    expect(find.text('Заказ получен'), findsOneWidget);
    expect(find.text('Ждём подтверждения точки'), findsOneWidget);
    await h.unmount(tester);
  });

  testWidgets('a late order owns up to it and offers to call the store', (tester) async {
    final api = FakeApi()
      ..storeExtra = {'acceptingOrders': true, 'phone': '+373 69 123 456'}
      ..currentOrder = FakeApi.sampleOrder(
        status: 'IN_PROGRESS',
        pickupAt: DateTime.now().subtract(const Duration(minutes: 3)),
      );
    final h = await pumpApp(tester, api: api);
    await openOrder(tester, h);

    expect(find.text('Немного задерживаемся'), findsWidgets);
    expect(find.text('0:00'), findsNothing, reason: 'no frozen countdown');
    expect(find.byKey(const ValueKey('call-store')), findsOneWidget);
    expect(find.text('Позвонить в точку'), findsOneWidget);
    await h.unmount(tester);
  });

  testWidgets('an expired order says the store did not confirm it and nothing was charged', (tester) async {
    final api = FakeApi()
      ..storeExtra = {'acceptingOrders': true, 'phone': '+373 69 123 456'}
      ..currentOrder = FakeApi.sampleOrder(status: 'EXPIRED');
    final h = await pumpApp(tester, api: api);
    await openOrder(tester, h);

    expect(find.text('Не состоялся'), findsWidgets);
    expect(find.text('Точка не подтвердила заказ — деньги не списаны'), findsOneWidget);
    expect(find.text('Деньги не списаны'), findsOneWidget);
    expect(find.byKey(const ValueKey('call-store')), findsNothing, reason: 'the order is over');
    await h.unmount(tester);
  });
}
