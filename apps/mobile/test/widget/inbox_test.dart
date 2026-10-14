import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/core/push/push_service.dart';
import 'package:takeaway_mobile/core/storage/app_prefs.dart';
import 'package:takeaway_mobile/features/inbox/inbox_item_screen.dart';
import 'package:takeaway_mobile/features/inbox/inbox_screen.dart';
import 'package:takeaway_mobile/features/inbox/inbox_widgets.dart';
import 'package:takeaway_mobile/features/menu/menu_screen.dart';
import 'package:takeaway_mobile/features/orders/order_status_screen.dart';
import 'package:takeaway_mobile/shared/widgets/cup_logo.dart';

import '../helpers/fake_api.dart';
import '../helpers/fake_push.dart';
import '../helpers/harness.dart';

void main() {
  const storeLink = {
    'kind': 'STORE',
    'storeId': 'st_2',
    'storeSlug': 'noname-balka',
    'brandId': 'br_1',
    'name': 'NoName — Балка',
  };

  FakeApi inboxApi() => FakeApi()
    ..moreStores = [
      {...FakeApi.storeJson, 'id': 'st_2', 'slug': 'noname-balka', 'name': 'NoName — Балка'},
    ]
    ..inboxItems = [
      FakeApi.inboxItemJson('inb_brand', link: storeLink),
      FakeApi.inboxItemJson(
        'inb_platform',
        kind: 'PLATFORM_ANNOUNCEMENT',
        title: 'Новое в takeAway',
        body: 'Теперь все новости заведений — в «Уведомлениях».',
        createdAt: DateTime.now().toUtc().subtract(const Duration(hours: 2)),
      ),
      FakeApi.inboxItemJson(
        'inb_old',
        title: 'Неделя круассанов',
        body: 'Второй круассан в подарок.',
        read: true,
        createdAt: DateTime.now().toUtc().subtract(const Duration(days: 3)),
      ),
    ];

  late FakePushService push;

  Future<Harness> launch(WidgetTester tester, {FakeApi? api, bool signedIn = true}) => pumpApp(
    tester,
    api: api ?? inboxApi(),
    signedIn: signedIn,
    startOnMenu: false,
    overrides: [pushServiceProvider.overrideWith((ref) => push = FakePushService(ref))],
  );

  Future<void> openFromBell(WidgetTester tester) async {
    await tester.tap(find.byKey(const ValueKey('inbox-bell')));
    await settle(tester);
    expect(find.byType(InboxScreen), findsOneWidget);
  }

  Finder row(String title) => find.ancestor(of: find.text(title), matching: find.byType(InboxRow));

  testWidgets('lists brand and platform messages with the unread ones marked, under a bell with the count', (
    tester,
  ) async {
    final h = await launch(tester);
    final bell = find.byKey(const ValueKey('inbox-bell'));
    expect(
      find.descendant(of: bell, matching: find.text('2')),
      findsOneWidget,
      reason: 'two unread messages',
    );

    await openFromBell(tester);
    expect(find.text('Уведомления'), findsOneWidget);
    expect(find.text('Прочитать все'), findsOneWidget);

    expect(find.descendant(of: row('−20% на капучино'), matching: find.text('NoName Coffee')), findsOneWidget);
    expect(find.descendant(of: row('−20% на капучино'), matching: find.text('5 мин назад')), findsOneWidget);
    expect(find.descendant(of: row('Новое в takeAway'), matching: find.byType(CupLogo)), findsOneWidget);
    expect(find.descendant(of: row('Новое в takeAway'), matching: find.text('takeAway')), findsOneWidget);
    expect(find.descendant(of: row('Новое в takeAway'), matching: find.text('2 ч назад')), findsOneWidget);
    expect(find.text('Теперь все новости заведений — в «Уведомлениях».'), findsOneWidget);

    expect(find.descendant(of: row('−20% на капучино'), matching: find.byType(InboxUnreadDot)), findsOneWidget);
    expect(find.descendant(of: row('Новое в takeAway'), matching: find.byType(InboxUnreadDot)), findsOneWidget);
    expect(find.descendant(of: row('Неделя круассанов'), matching: find.byType(InboxUnreadDot)), findsNothing);
    await h.unmount(tester);
  });

  testWidgets('a message without a link opens in full and is read; back returns to the list', (tester) async {
    final h = await launch(tester);
    await openFromBell(tester);

    await tester.tap(row('Новое в takeAway'));
    await settle(tester);
    expect(find.byType(InboxItemScreen), findsOneWidget);
    expect(find.text('Теперь все новости заведений — в «Уведомлениях».'), findsOneWidget);
    expect(find.byType(FilledButton), findsNothing, reason: 'an announcement that links nowhere has no button');
    expect(h.api.inboxReads, ['inb_platform']);

    await tester.tap(find.byType(BackButton));
    await settle(tester);
    expect(find.byType(InboxScreen), findsOneWidget);
    expect(find.descendant(of: row('Новое в takeAway'), matching: find.byType(InboxUnreadDot)), findsNothing);
    await h.unmount(tester);
  });

  testWidgets('a message linking a store reads it and opens that store\'s menu', (tester) async {
    final h = await launch(tester);
    await openFromBell(tester);

    await tester.tap(row('−20% на капучино'));
    await settle(tester);

    expect(h.api.inboxReads, ['inb_brand']);
    expect(h.container.read(activeStoreIdProvider), 'st_2');
    expect(find.byType(MenuScreen), findsOneWidget);
    expect(find.byType(InboxScreen), findsNothing);
    await h.unmount(tester);
  });

  testWidgets('«Прочитать все» clears every dot and the badges', (tester) async {
    final h = await launch(tester);
    await openFromBell(tester);

    await tester.tap(find.text('Прочитать все'));
    await settle(tester);

    expect(h.api.inboxReadAlls, 1);
    expect(find.byType(InboxUnreadDot), findsNothing);
    expect(find.text('Прочитать все'), findsNothing);

    await tester.tap(find.byType(BackButton));
    await settle(tester);
    final bell = find.byKey(const ValueKey('inbox-bell'));
    expect(
      find.descendant(of: bell, matching: find.byType(Text)),
      findsNothing,
      reason: 'no count on the bell',
    );
    await h.unmount(tester);
  });

  testWidgets('says so when there is nothing yet', (tester) async {
    final h = await launch(tester, api: FakeApi());
    await openFromBell(tester);
    expect(find.text('Пока пусто'), findsOneWidget);
    expect(find.text('Здесь появятся новости от заведений и takeAway.'), findsOneWidget);
    expect(find.text('Прочитать все'), findsNothing);
    await h.unmount(tester);
  });

  testWidgets('a guest has no bell', (tester) async {
    final h = await launch(tester, signedIn: false);
    expect(find.byKey(const ValueKey('inbox-bell')), findsNothing);
    await h.unmount(tester);
  });

  testWidgets('the profile opens «Уведомления» with the unread count, apart from the notification settings', (
    tester,
  ) async {
    final h = await launch(tester);
    h.container.read(routerProvider).go(Routes.profile);
    await settle(tester);

    final inboxRow = find.ancestor(of: find.text('Уведомления'), matching: find.byType(ListTile));
    expect(find.descendant(of: inboxRow, matching: find.byType(InboxCountPill)), findsOneWidget);
    expect(find.descendant(of: inboxRow, matching: find.text('2')), findsOneWidget);
    expect(find.text('Настройки уведомлений'), findsOneWidget);

    await tester.tap(inboxRow);
    await settle(tester);
    expect(find.byType(InboxScreen), findsOneWidget);
    await h.unmount(tester);
  });

  group('push taps', () {
    testWidgets('a campaign push opens its message over the list', (tester) async {
      final h = await launch(tester);
      push.tap(PushMessage.fromData({'kind': 'campaign', 'notificationId': 'inb_platform'}));
      await settle(tester);

      expect(find.byType(InboxItemScreen), findsOneWidget);
      expect(find.text('Новое в takeAway'), findsOneWidget);
      expect(h.api.inboxReads, ['inb_platform']);

      await tester.tap(find.byType(BackButton));
      await settle(tester);
      expect(find.byType(InboxScreen), findsOneWidget, reason: 'back leads to the rest of «Уведомления»');
      await h.unmount(tester);
    });

    testWidgets('a campaign push without a message opens the list', (tester) async {
      final h = await launch(tester);
      push.tap(PushMessage.fromData({'kind': 'campaign'}));
      await settle(tester);
      expect(find.byType(InboxScreen), findsOneWidget);
      expect(find.byType(InboxItemScreen), findsNothing);
      await h.unmount(tester);
    });

    testWidgets('a message that is gone says so', (tester) async {
      final h = await launch(tester);
      push.tap(PushMessage.fromData({'kind': 'announcement', 'notificationId': 'inb_deleted'}));
      await settle(tester);
      expect(find.text('Это уведомление больше недоступно.'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('an order push still opens the order', (tester) async {
      final h = await launch(tester);
      push.tap(PushMessage.fromData({'kind': 'order_ready', 'orderId': 'ord_1'}));
      await settle(tester);
      expect(find.byType(OrderStatusScreen), findsOneWidget);
      expect(find.byType(InboxScreen), findsNothing);
      await h.unmount(tester);
    });

    testWidgets('a campaign arriving in the foreground bumps the badge and offers to open it', (tester) async {
      final api = inboxApi();
      final h = await launch(tester, api: api);
      api.inboxItems = [FakeApi.inboxItemJson('inb_new', title: 'Новинка: раф'), ...api.inboxItems];

      push.receive(
        PushMessage.fromData(
          {'kind': 'campaign', 'notificationId': 'inb_new'},
          title: 'NoName Coffee: Новинка: раф',
          body: 'Попробуйте первым',
        ),
      );
      await settle(tester);
      final bell = find.byKey(const ValueKey('inbox-bell'));
      expect(find.descendant(of: bell, matching: find.text('3')), findsOneWidget);
      expect(find.text('NoName Coffee: Новинка: раф · Попробуйте первым'), findsOneWidget);

      await tester.tap(find.text('Открыть'));
      await settle(tester);
      expect(find.byType(InboxItemScreen), findsOneWidget);
      expect(find.text('Новинка: раф'), findsOneWidget);
      await h.unmount(tester);
    });
  });
}
