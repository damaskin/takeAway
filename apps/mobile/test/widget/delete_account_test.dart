import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/core/providers.dart';
import 'package:takeaway_mobile/features/profile/profile_screen.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

void main() {
  Future<Harness> openProfile(WidgetTester tester, {FakeApi? api}) async {
    final h = await pumpApp(tester, api: api);
    h.container.read(routerProvider).go(Routes.profile);
    await settle(tester);
    await tester.scrollUntilVisible(
      find.text('Удалить аккаунт'),
      300,
      scrollable: find.descendant(of: find.byType(ProfileScreen), matching: find.byType(Scrollable)).first,
    );
    await settle(tester, const Duration(milliseconds: 300));
    return h;
  }

  String location(Harness h) => h.container.read(routerProvider).routerDelegate.currentConfiguration.uri.path;

  testWidgets('deleting the account calls the API, signs out and returns to the menu', (tester) async {
    final h = await openProfile(tester);
    await h.container.read(sharedPreferencesProvider).setString('checkout.phone', '+37377700000');

    await tester.tap(find.text('Удалить аккаунт'));
    await settle(tester);
    expect(find.text('Удалить аккаунт?'), findsOneWidget);
    expect(find.textContaining('в обезличенном виде'), findsOneWidget, reason: 'says what happens to the orders');
    expect(find.textContaining('Отменить удаление нельзя'), findsOneWidget);

    await tester.tap(find.text('Удалить навсегда'));
    await settle(tester);

    expect(h.api.accountsDeleted, 1);
    expect(h.container.read(isSignedInProvider), isFalse);
    expect(h.container.read(sessionManagerProvider).current, isNull);
    expect(h.container.read(sharedPreferencesProvider).getString('checkout.phone'), isNull);
    expect(location(h), Routes.menu);
    expect(find.text('Аккаунт удалён'), findsOneWidget);
    await h.unmount(tester);
  });

  testWidgets('cancelling the confirmation deletes nothing', (tester) async {
    final h = await openProfile(tester);

    await tester.tap(find.text('Удалить аккаунт'));
    await settle(tester);
    await tester.tap(find.text('Отмена'));
    await settle(tester);

    expect(find.byType(AlertDialog), findsNothing);
    expect(h.api.accountsDeleted, 0);
    expect(h.container.read(isSignedInProvider), isTrue);
    expect(location(h), Routes.profile);
    expect(find.text('Удалить аккаунт'), findsOneWidget);
    await h.unmount(tester);
  });

  testWidgets('a guest has no account to delete', (tester) async {
    final h = await pumpApp(tester, signedIn: false);
    h.container.read(routerProvider).go(Routes.profile);
    await settle(tester);

    expect(find.text('Войти'), findsWidgets);
    expect(find.text('Удалить аккаунт'), findsNothing);
    await h.unmount(tester);
  });

  testWidgets('a staff account is refused and stays signed in', (tester) async {
    final h = await openProfile(tester, api: FakeApi()..deleteAccountStatus = 403);

    await tester.tap(find.text('Удалить аккаунт'));
    await settle(tester);
    await tester.tap(find.text('Удалить навсегда'));
    await settle(tester);

    expect(find.text('Аккаунты сотрудников удаляет администратор заведения.'), findsOneWidget);
    expect(h.container.read(isSignedInProvider), isTrue);
    expect(location(h), Routes.profile);
    await h.unmount(tester);
  });
}
