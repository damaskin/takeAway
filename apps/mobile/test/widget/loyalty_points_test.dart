import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/shared/widgets/app_button.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

/// Points, not the units the API counts them in (1 point = 1 руб., a unit
/// is a hundredth of a point): the balance, the ledger, the tier, the
/// referral total and the amount spent at checkout, typed with decimals.
void main() {
  const nbsp = ' ';

  Future<void> reveal(WidgetTester tester, Finder finder) async {
    await tester.scrollUntilVisible(finder, 200, scrollable: find.byType(Scrollable).first);
    await tester.ensureVisible(finder);
    await settle(tester, const Duration(milliseconds: 400));
  }

  SwitchListTile pointsSwitch(WidgetTester tester) => tester.widget<SwitchListTile>(find.byType(SwitchListTile));

  final amountField = find.byKey(const ValueKey('points-amount'));

  String amountText(WidgetTester tester) => tester.widget<TextField>(amountField).controller!.text;

  Future<void> typeAmount(WidgetTester tester, String text) async {
    await reveal(tester, amountField);
    await tester.enterText(amountField, text);
    await tester.testTextInput.receiveAction(TextInputAction.done);
    await settle(tester);
  }

  group('checkout', () {
    /// A 15 MDL croissant, a card and 12,40 points.
    FakeApi checkoutApi() => FakeApi(flags: const FeatureFlags(agroprombankEnabled: true))
      ..boundCards = [FakeApi.card()]
      ..pointsBalance = 1240
      ..seedCart(FakeApi.croissant());

    Future<Harness> openCheckout(WidgetTester tester, FakeApi api) async {
      final h = await pumpApp(tester, api: api);
      await tester.tap(find.textContaining('позици'));
      await settle(tester);
      await tester.tap(find.textContaining('К оформлению'));
      await settle(tester);
      await reveal(tester, find.byType(SwitchListTile));
      return h;
    }

    testWidgets('spends points typed with decimals and shows the quote back', (tester) async {
      final api = checkoutApi();
      final h = await openCheckout(tester, api);
      expect(find.text('Доступно 12,40 балла'), findsOneWidget);
      expect(amountField, findsNothing, reason: 'the field comes with the switch');

      await tester.tap(find.byType(SwitchListTile));
      await settle(tester);
      expect(api.redeemQuotes.last['points'], 1240, reason: 'the whole balance, in units');
      expect(find.text('Списано 12,40 балла · минус 12,40${nbsp}MDL'), findsOneWidget);
      expect(amountText(tester), '12,40');
      expect(find.text('Не больше 12,40 балла'), findsOneWidget);

      await typeAmount(tester, '2.5');
      expect(api.redeemQuotes.last['points'], 250);
      expect(api.redeemQuotes, hasLength(2), reason: 'asked once, though the done key also leaves the field');
      expect(find.text('Списано 2,50 балла · минус 2,50${nbsp}MDL'), findsOneWidget);
      expect(amountText(tester), '2,50');

      // More than there is: the server's clamp comes back into the field.
      await typeAmount(tester, '40');
      expect(api.redeemQuotes.last['points'], 4000);
      expect(amountText(tester), '12,40');

      await typeAmount(tester, '3');
      expect(find.text('Списано 3 балла · минус 3${nbsp}MDL'), findsOneWidget);
      await reveal(tester, find.text('Итого'));
      expect(find.text('Баллы'), findsOneWidget, reason: 'the summary takes them off');

      await tester.tap(find.byType(PrimaryButton));
      await settle(tester, const Duration(seconds: 2));
      expect(api.created.single.toJson()['pointsToSpend'], 300);
      await h.unmount(tester);
    });

    testWidgets('names the minimum in points and keeps what was typed under it', (tester) async {
      final api = checkoutApi();
      final h = await openCheckout(tester, api);
      await tester.tap(find.byType(SwitchListTile));
      await settle(tester);

      await typeAmount(tester, '0,5');
      expect(api.redeemQuotes.last['points'], 50);
      expect(find.text('Минимум 1 балл и не больше суммы заказа.'), findsOneWidget);
      expect(amountText(tester), '0,5');
      expect(pointsSwitch(tester).value, isTrue, reason: 'the customer is still choosing');

      await tester.tap(find.byType(PrimaryButton));
      await settle(tester, const Duration(seconds: 2));
      expect(api.created.single.toJson()['pointsToSpend'], isNull, reason: 'nothing under the minimum goes');
      await h.unmount(tester);
    });

    testWidgets('a balance under the minimum says so and stays off', (tester) async {
      final api = checkoutApi()..pointsBalance = 40;
      final h = await openCheckout(tester, api);
      expect(find.text('Доступно 0,40 балла'), findsOneWidget);

      await tester.tap(find.byType(SwitchListTile));
      await settle(tester);
      expect(find.text('Минимум 1 балл и не больше суммы заказа.'), findsOneWidget);
      expect(pointsSwitch(tester).value, isFalse);
      expect(amountField, findsNothing);
      await h.unmount(tester);
    });

    testWidgets('the field takes digits and up to two decimals only', (tester) async {
      final api = checkoutApi();
      final h = await openCheckout(tester, api);
      await tester.tap(find.byType(SwitchListTile));
      await settle(tester);

      await reveal(tester, amountField);
      await tester.enterText(amountField, '1,234');
      expect(amountText(tester), '12,40', reason: 'a third decimal is refused');
      await tester.enterText(amountField, '7,2');
      await tester.enterText(amountField, '7,2a');
      expect(amountText(tester), '7,2');
      await h.unmount(tester);
    });
  });

  group('profile', () {
    testWidgets('the loyalty screen shows points: balance, tier, operations', (tester) async {
      final api = FakeApi()
        ..pointsBalance = 1240
        ..pointsToNextTier = 350
        ..loyaltyRecent = [
          LoyaltyEntry(id: 'l1', type: 'EARN', amount: 40, reason: 'Заказ A-12', createdAt: DateTime(2026, 11, 10)),
          LoyaltyEntry(id: 'l2', type: 'SPEND', amount: -320, reason: 'Заказ A-13', createdAt: DateTime(2026, 11, 11)),
          LoyaltyEntry(id: 'l3', type: 'EARN', amount: 1500, reason: 'Бонус', createdAt: DateTime(2026, 11, 12)),
        ];
      final h = await pumpApp(tester, api: api);
      unawaited(h.container.read(routerProvider).push(Routes.loyalty));
      await settle(tester, const Duration(seconds: 2));

      expect(find.text('12,40'), findsOneWidget, reason: 'the balance, counted up in points');
      expect(find.text('Ещё 3,50 балла до уровня «Золото»'), findsOneWidget);
      expect(find.text('+0,40'), findsOneWidget);
      expect(find.text('−3,20'), findsOneWidget);
      expect(find.text('+15'), findsOneWidget);
      expect(find.text('1240'), findsNothing);
      await h.unmount(tester);
    });

    testWidgets('a whole balance counts up in whole points', (tester) async {
      final api = FakeApi()
        ..pointsBalance = 3000
        ..pointsToNextTier = 2000;
      final h = await pumpApp(tester, api: api);
      unawaited(h.container.read(routerProvider).push(Routes.loyalty));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 300));
      final midway = tester
          .widgetList<Text>(find.byType(Text))
          .map((t) => t.data ?? '')
          .where((t) => RegExp(r'^\d+([.,]\d+)?$').hasMatch(t));
      expect(midway, isNotEmpty);
      expect(midway, isNot(contains('30')), reason: 'still counting');
      expect(midway, everyElement(isNot(contains(','))), reason: 'no decimals on the way to «30»');
      await settle(tester, const Duration(seconds: 2));
      expect(find.text('30'), findsOneWidget);
      expect(find.text('Ещё 20 баллов до уровня «Золото»'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('the referral total is in points', (tester) async {
      final api = FakeApi()
        ..referralSummary = const ReferralSummary(
          code: 'FRIEND1',
          signupsCount: 3,
          rewardedCount: 2,
          pointsEarned: 20050,
        );
      final h = await pumpApp(tester, api: api);
      unawaited(h.container.read(routerProvider).push(Routes.referrals));
      await settle(tester);

      expect(find.text('200,50'), findsOneWidget);
      expect(find.text('20050'), findsNothing);
      await h.unmount(tester);
    });
  });
}
