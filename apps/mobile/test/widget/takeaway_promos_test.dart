import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/core/push/push_service.dart';
import 'package:takeaway_mobile/shared/widgets/app_button.dart';

import '../helpers/fake_api.dart';
import '../helpers/fake_push.dart';
import '../helpers/harness.dart';

/// «Акции takeAway» in the app (docs/takeaway-promos.md §5): the welcome
/// bonus on the profile, applied at checkout by itself and removable, no
/// points next to a takeAway promo, and the promo's line on the order.
void main() {
  const bonusTitle = 'Приветственный бонус −10%';
  const noPoints = 'Баллы нельзя совместить с промокодом';

  String location(Harness h) => h.container.read(routerProvider).routerDelegate.currentConfiguration.uri.path;

  Future<void> reveal(WidgetTester tester, Finder finder) async {
    await tester.scrollUntilVisible(finder, 200, scrollable: find.byType(Scrollable).first);
    await tester.ensureVisible(finder);
    await settle(tester, const Duration(milliseconds: 400));
  }

  Future<void> openCheckout(WidgetTester tester) async {
    await tester.tap(find.textContaining('позици'));
    await settle(tester);
    await tester.tap(find.textContaining('К оформлению'));
    await settle(tester);
  }

  Future<void> enterPromo(WidgetTester tester, String code, {String label = 'Промокод'}) async {
    final field = find.widgetWithText(TextField, label);
    await reveal(tester, field);
    await tester.enterText(field, code);
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await settle(tester);
  }

  SwitchListTile pointsSwitch(WidgetTester tester) => tester.widget<SwitchListTile>(find.byType(SwitchListTile));

  /// A customer with a 15 MDL croissant in the cart, a card and 500 points.
  FakeApi checkoutApi({List<Map<String, dynamic>>? bonuses}) =>
      FakeApi(flags: const FeatureFlags(agroprombankEnabled: true))
        ..boundCards = [FakeApi.card()]
        ..pointsBalance = 500
        ..seedCart(FakeApi.croissant())
        ..bonuses = bonuses ?? [FakeApi.welcomeBonusJson()]
        ..promoAnswers['WELCOME10'] = FakeApi.takeawayPromoAnswer(discountCents: 150);

  group('profile', () {
    testWidgets('shows the welcome bonus while there is one, and a tap leads to ordering', (tester) async {
      final api = FakeApi()..bonuses = [FakeApi.welcomeBonusJson(expiresAt: DateTime(2026, 11, 17, 12))];
      final h = await pumpApp(tester, api: api);
      h.container.read(routerProvider).go(Routes.profile);
      await settle(tester);

      expect(find.text('Мои бонусы'), findsOneWidget);
      expect(find.text(bonusTitle), findsOneWidget);
      expect(find.text('На заказ в любом заведении · до 17 ноября'), findsOneWidget);

      await reveal(tester, find.byKey(const ValueKey('welcome-bonus')));
      await tester.tap(find.byKey(const ValueKey('welcome-bonus')));
      await settle(tester);
      expect(location(h), Routes.menu, reason: 'the menu of the store picked last time');
      await h.unmount(tester);
    });

    testWidgets('shows nothing without a bonus, past its expiry, or from an API that predates bonuses', (tester) async {
      for (final api in [
        FakeApi(),
        FakeApi()..bonuses = [FakeApi.welcomeBonusJson(expiresAt: DateTime.now().subtract(const Duration(hours: 1)))],
        FakeApi()..bonusesStatus = 404,
      ]) {
        final h = await pumpApp(tester, api: api);
        h.container.read(routerProvider).go(Routes.profile);
        await settle(tester);

        expect(find.text('Мои бонусы'), findsNothing);
        expect(find.textContaining('Приветственный бонус'), findsNothing);
        expect(find.text('Профиль'), findsWidgets, reason: 'the rest of the profile is there, with no error');
        await h.unmount(tester);
      }
    });

    testWidgets('the welcome push brings the banner without a restart', (tester) async {
      late FakePushService push;
      final api = FakeApi();
      final h = await pumpApp(
        tester,
        api: api,
        overrides: [pushServiceProvider.overrideWith((ref) => push = FakePushService(ref))],
      );
      h.container.read(routerProvider).go(Routes.profile);
      await settle(tester);
      expect(find.text(bonusTitle), findsNothing);

      // Handed out at sign-up; the push follows a minute later.
      api.bonuses = [FakeApi.welcomeBonusJson()];
      push.receive(
        PushMessage.fromData(
          {'kind': 'announcement', 'notificationId': 'inb_welcome'},
          title: 'Приветственный бонус',
          body: 'Добрый день! Добро пожаловать в экосистему takeAway.',
        ),
      );
      await settle(tester);
      expect(find.text(bonusTitle), findsOneWidget);
      await h.unmount(tester);
    });
  });

  group('checkout', () {
    testWidgets('puts the welcome bonus in by itself, turns points off and orders with none', (tester) async {
      final api = checkoutApi();
      final h = await pumpApp(tester, api: api);
      await openCheckout(tester);

      expect(api.promoChecks, hasLength(1));
      expect(api.promoChecks.single, {
        'code': 'WELCOME10',
        'brandId': 'br_1',
        'subtotalCents': 1500,
        'storeId': 'st_1',
      }, reason: 'checked for this store: the bonus works only where its currency is sold');

      await reveal(tester, find.text('Убрать'));
      expect(find.widgetWithText(TextField, 'WELCOME10'), findsOneWidget, reason: 'the code is in the promo field');
      expect(find.text(bonusTitle), findsWidgets);
      expect(pointsSwitch(tester).onChanged, isNull);
      expect(pointsSwitch(tester).value, isFalse);
      expect(find.text(noPoints), findsOneWidget);

      await reveal(tester, find.text('Итого'));
      expect(find.text('Промокод WELCOME10'), findsNothing, reason: 'the summary names the bonus, not the code');

      await tester.tap(find.byType(PrimaryButton));
      await settle(tester, const Duration(seconds: 2));
      final order = api.created.single.toJson();
      expect(order['couponCode'], 'WELCOME10');
      expect(order['pointsToSpend'], 0, reason: 'a takeAway promo goes with no points (PROMO_WITH_POINTS)');
      await h.unmount(tester);
    });

    testWidgets('a removed bonus stays off for the cart, and the customer may type it back', (tester) async {
      final api = checkoutApi();
      final h = await pumpApp(tester, api: api);
      await openCheckout(tester);

      await reveal(tester, find.text('Убрать'));
      await tester.tap(find.text('Убрать'));
      await settle(tester);
      expect(find.text(bonusTitle), findsNothing);
      expect(find.widgetWithText(TextField, 'WELCOME10'), findsNothing);
      expect(pointsSwitch(tester).onChanged, isNotNull, reason: 'points are back on offer');
      expect(find.text('Доступно 500 баллов'), findsOneWidget);

      // Back to the cart and into checkout again: not put back.
      h.container.read(routerProvider).pop();
      await settle(tester);
      await tester.tap(find.textContaining('К оформлению'));
      await settle(tester);
      expect(api.promoChecks, hasLength(1));
      expect(find.text(bonusTitle), findsNothing);

      await enterPromo(tester, 'welcome10');
      expect(api.promoChecks, hasLength(2));
      expect(find.text(bonusTitle), findsWidgets);
      expect(find.text('Убрать'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('a typed takeAway code takes off the points already chosen', (tester) async {
      final api = checkoutApi(bonuses: const [])
        ..promoAnswers['AUTUMN'] = FakeApi.takeawayPromoAnswer(
          code: 'AUTUMN',
          percent: 15,
          isWelcome: false,
          discountCents: 225,
        );
      final h = await pumpApp(tester, api: api);
      await openCheckout(tester);
      expect(api.promoChecks, isEmpty, reason: 'no bonus, nothing applied by itself');

      await reveal(tester, find.byType(SwitchListTile));
      await tester.tap(find.byType(SwitchListTile));
      await settle(tester);
      expect(pointsSwitch(tester).value, isTrue);
      expect(find.textContaining('500 баллов · минус'), findsOneWidget);

      await enterPromo(tester, 'AUTUMN');
      expect(find.text('Акция takeAway −15%'), findsWidgets);
      expect(pointsSwitch(tester).value, isFalse, reason: 'the points came off');
      expect(pointsSwitch(tester).onChanged, isNull);
      expect(find.text(noPoints), findsOneWidget);
      expect(find.text('Убрать'), findsNothing, reason: 'a code the customer typed clears with the cross');

      await tester.tap(find.byType(PrimaryButton));
      await settle(tester, const Duration(seconds: 2));
      final order = api.created.single.toJson();
      expect(order['couponCode'], 'AUTUMN');
      expect(order['pointsToSpend'], 0);
      await h.unmount(tester);
    });

    testWidgets('a brand code keeps points on offer and comes off with the cross', (tester) async {
      final api = checkoutApi(bonuses: const [])
        ..promoAnswers['COFFEE'] = {'valid': true, 'source': 'BRAND', 'discountCents': 200, 'pointsMultiplier': 1};
      final h = await pumpApp(tester, api: api);
      await openCheckout(tester);

      await enterPromo(tester, 'COFFEE');
      expect(find.text('Скидка 2 MDL'), findsOneWidget);
      expect(pointsSwitch(tester).onChanged, isNotNull);
      expect(find.text(noPoints), findsNothing);

      // The applied field is read-only, but its cross still takes a tap.
      await tester.tap(find.byIcon(Icons.close_rounded));
      await settle(tester);
      expect(find.text('Скидка 2 MDL'), findsNothing);
      expect(find.widgetWithText(TextField, 'COFFEE'), findsNothing);
      expect(api.promoChecks, hasLength(1), reason: 'no bonus is held, nothing comes in its place');
      await h.unmount(tester);
    });

    testWidgets('leaves the bonus out at a store in another currency', (tester) async {
      final api = checkoutApi(bonuses: [FakeApi.welcomeBonusJson(currency: 'RUP')]);
      final h = await pumpApp(tester, api: api);
      await openCheckout(tester);

      expect(api.promoChecks, isEmpty);
      expect(find.text(bonusTitle), findsNothing);
      expect(pointsSwitch(tester).onChanged, isNotNull);
      await h.unmount(tester);
    });

    testWidgets('a bonus the API refuses clears quietly, and the profile reads the bonuses again', (tester) async {
      final api = checkoutApi()
        ..promoAnswers['WELCOME10'] = {
          'valid': false,
          'reason': 'Promo budget is exhausted',
          'reasonCode': 'PROMO_LIMIT_REACHED',
          'discountCents': 0,
          'pointsMultiplier': 1,
        };
      final h = await pumpApp(tester, api: api);
      final readsBefore = api.bonusReads;
      await openCheckout(tester);

      expect(api.promoChecks, hasLength(1));
      expect(find.text('Промокод закончился'), findsNothing, reason: 'the customer never asked for it');
      expect(find.widgetWithText(TextField, 'WELCOME10'), findsNothing);
      expect(api.bonusReads, greaterThan(readsBefore));
      expect(api.promoChecks, hasLength(1), reason: 'tried once, not in a loop');
      await h.unmount(tester);
    });

    testWidgets('words the takeAway refusals in the app language', (tester) async {
      final api = checkoutApi(bonuses: const [])
        ..promoAnswers['RUPONLY'] = {
          'valid': false,
          'reason': 'Promo does not run in this currency',
          'reasonCode': 'PROMO_NOT_HERE',
          'discountCents': 0,
          'pointsMultiplier': 1,
        }
        ..promoAnswers['WELCOME10'] = {
          'valid': false,
          'reason': 'No welcome bonus for this customer',
          'reasonCode': 'PROMO_NOT_ELIGIBLE',
          'discountCents': 0,
          'pointsMultiplier': 1,
        };
      var h = await pumpApp(tester, api: api);
      await openCheckout(tester);

      await enterPromo(tester, 'RUPONLY');
      expect(find.text('Акция не действует в этом заведении'), findsOneWidget);
      await enterPromo(tester, 'WELCOME10');
      expect(find.text('Этот промокод вам недоступен'), findsOneWidget);

      api.orderRefusal = {'code': 'PROMO_WITH_POINTS', 'message': 'A takeAway promo does not combine with points'};
      await tester.tap(find.byType(PrimaryButton));
      await settle(tester, const Duration(seconds: 2));
      expect(find.text(noPoints), findsWidgets);
      expect(find.textContaining('does not combine'), findsNothing);
      await h.unmount(tester);

      h = await pumpApp(
        tester,
        api: checkoutApi(bonuses: const [])..promoAnswer = api.promoAnswers['RUPONLY'],
        locale: const Locale('en'),
      );
      unawaited(h.container.read(routerProvider).push(Routes.checkout));
      await settle(tester);
      await enterPromo(tester, 'RUPONLY', label: 'Promo code');
      expect(find.text("This promo doesn't apply at this venue"), findsOneWidget);
      h.api.orderRefusal = {'code': 'PROMO_WITH_POINTS', 'message': 'A takeAway promo does not combine with points'};
      await tester.tap(find.byType(PrimaryButton));
      await settle(tester, const Duration(seconds: 2));
      expect(find.text("Points can't be combined with a promo code"), findsOneWidget);
      await h.unmount(tester);
    });
  });

  group('order screen', () {
    Future<void> openOrder(WidgetTester tester, Harness h) async {
      unawaited(h.container.read(routerProvider).push(Routes.order('ord_1')));
      await settle(tester);
    }

    testWidgets('names the takeAway promo on its discount line', (tester) async {
      final api = FakeApi()
        ..currentOrder = FakeApi.sampleOrder(
          discountCents: 200,
          takeawayPromo: {
            'code': 'WELCOME10',
            'name': 'Приветственный бонус',
            'percent': 10,
            'menuTotalCents': 2000,
            'discountCents': 200,
            'paidByGuestCents': 1800,
          },
        );
      final h = await pumpApp(tester, api: api);
      await openOrder(tester, h);

      await reveal(tester, find.text('Акция takeAway −10%'));
      expect(find.text('− 2 MDL'), findsOneWidget);
      expect(find.text('Скидки'), findsNothing, reason: 'nothing else lowered the price');
      await h.unmount(tester);
    });

    testWidgets('an order without one, or from an older API, keeps the plain discount line', (tester) async {
      final api = FakeApi()..currentOrder = FakeApi.sampleOrder(discountCents: 200);
      final h = await pumpApp(tester, api: api);
      await openOrder(tester, h);

      await reveal(tester, find.text('Скидки'));
      expect(find.textContaining('Акция takeAway'), findsNothing);
      await h.unmount(tester);
    });
  });
}
