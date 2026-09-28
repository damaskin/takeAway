import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:sign_in_with_apple/sign_in_with_apple.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/core/providers.dart';
import 'package:takeaway_mobile/features/auth/auth_service.dart';
import 'package:takeaway_mobile/features/profile/profile_screen.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

/// An iOS build with Sign in with Apple, without Apple's sheet.
class FakeAppleAuthorization extends AppleAuthorization {
  FakeAppleAuthorization({this.cancel = false});

  final bool cancel;
  final requests = <List<AppleIDAuthorizationScopes>>[];

  @override
  bool get available => true;

  @override
  Future<AuthorizationCredentialAppleID> request(List<AppleIDAuthorizationScopes> scopes) async {
    requests.add(scopes);
    if (cancel) {
      throw const SignInWithAppleAuthorizationException(code: AuthorizationErrorCode.canceled, message: 'Canceled');
    }
    return const AuthorizationCredentialAppleID(
      userIdentifier: 'apple_user',
      givenName: null,
      familyName: null,
      authorizationCode: 'apple_code',
      email: null,
      identityToken: 'apple_id_token',
      state: null,
    );
  }
}

void main() {
  Future<Harness> openProfile(WidgetTester tester, {FakeApi? api, AppleAuthorization? apple}) async {
    final h = await pumpApp(
      tester,
      api: api,
      overrides: [if (apple != null) appleAuthorizationProvider.overrideWithValue(apple)],
    );
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

  Future<void> confirmDeletion(WidgetTester tester) async {
    await tester.tap(find.text('Удалить аккаунт'));
    await settle(tester);
    await tester.tap(find.text('Удалить навсегда'));
    await settle(tester);
  }

  String location(Harness h) => h.container.read(routerProvider).routerDelegate.currentConfiguration.uri.path;

  const appleLinked = SignInMethods(telegram: true, google: false, apple: true);

  testWidgets('deleting the account calls the API, signs out and returns to the menu', (tester) async {
    final h = await openProfile(tester);
    await h.container.read(sharedPreferencesProvider).setString('checkout.phone', '+37377700000');

    await tester.tap(find.text('Удалить аккаунт'));
    await settle(tester);
    expect(find.text('Удалить аккаунт?'), findsOneWidget);
    expect(find.textContaining('в обезличенном виде'), findsOneWidget, reason: 'says what happens to the orders');
    expect(find.textContaining('Отменить удаление нельзя'), findsOneWidget);
    expect(find.textContaining('Apple'), findsNothing, reason: 'no Sign in with Apple on this build');

    await tester.tap(find.text('Удалить навсегда'));
    await settle(tester);

    expect(h.api.deleteRequests, hasLength(1));
    expect(h.api.deleteRequests.single?.appleAuthorizationCode, isNull);
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
    expect(h.api.deleteRequests, isEmpty);
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

    await confirmDeletion(tester);

    expect(find.text('Аккаунты сотрудников удаляет администратор заведения.'), findsOneWidget);
    expect(h.container.read(isSignedInProvider), isTrue);
    expect(location(h), Routes.profile);
    await h.unmount(tester);
  });

  group('with Sign in with Apple', () {
    testWidgets('an Apple-linked account confirms with Apple and sends the authorization code', (tester) async {
      final apple = FakeAppleAuthorization();
      final h = await openProfile(tester, api: FakeApi()..methods = appleLinked, apple: apple);

      await tester.tap(find.text('Удалить аккаунт'));
      await settle(tester);
      expect(find.textContaining('Apple попросит подтвердить удаление'), findsOneWidget);
      await tester.tap(find.text('Удалить навсегда'));
      await settle(tester);

      expect(apple.requests, [isEmpty], reason: 'one request, with no name or email asked for');
      expect(h.api.deleteRequests.single?.appleAuthorizationCode, 'apple_code');
      expect(h.container.read(isSignedInProvider), isFalse);
      expect(location(h), Routes.menu);
      await h.unmount(tester);
    });

    testWidgets('backing out of Apple\'s sheet deletes nothing', (tester) async {
      final apple = FakeAppleAuthorization(cancel: true);
      final h = await openProfile(tester, api: FakeApi()..methods = appleLinked, apple: apple);

      await confirmDeletion(tester);

      expect(apple.requests, hasLength(1));
      expect(h.api.deleteRequests, isEmpty);
      expect(h.container.read(isSignedInProvider), isTrue);
      expect(location(h), Routes.profile);
      expect(find.text('Для удаления аккаунта нужно подтверждение через Apple.'), findsOneWidget);
      await h.unmount(tester);
    });

    testWidgets('an account Apple does not lead into is deleted without asking Apple', (tester) async {
      final apple = FakeAppleAuthorization();
      final h = await openProfile(tester, apple: apple);

      await tester.tap(find.text('Удалить аккаунт'));
      await settle(tester);
      expect(find.textContaining('Apple'), findsNothing);
      await tester.tap(find.text('Удалить навсегда'));
      await settle(tester);

      expect(apple.requests, isEmpty);
      expect(h.api.deleteRequests.single?.appleAuthorizationCode, isNull);
      expect(h.container.read(isSignedInProvider), isFalse);
      await h.unmount(tester);
    });
  });
}
