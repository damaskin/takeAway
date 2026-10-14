import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/core/providers.dart';
import 'package:takeaway_mobile/features/auth/sign_in_sheet.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

void main() {
  final addressField = find.byKey(const ValueKey('email-sign-in-address'));
  final codeField = find.byKey(const ValueKey('email-sign-in-code'));

  /// A guest on the profile tab taps «Войти»; the sign-in sheet opens.
  Future<Harness> openSheet(WidgetTester tester, {FakeApi? api}) async {
    final h = await pumpApp(tester, api: api, signedIn: false);
    h.container.read(routerProvider).go(Routes.profile);
    await settle(tester);
    await tester.tap(find.text('Войти'));
    await settle(tester);
    expect(find.byType(SignInSheet), findsOneWidget);
    return h;
  }

  /// A frame or two: enough for the fake API to answer, not for the resend timer to tick.
  Future<void> brief(WidgetTester tester) async {
    await tester.pump();
    await tester.pump(const Duration(milliseconds: 100));
  }

  /// «Войти по почте» → the address → «Получить код».
  Future<void> requestCode(WidgetTester tester, [String address = 'ivan@mail.ru']) async {
    await tester.tap(find.text('Войти по почте'));
    await settle(tester, const Duration(milliseconds: 400));
    await tester.enterText(addressField, address);
    await tester.pump();
    await tester.tap(find.text('Получить код'));
    await brief(tester);
  }

  FakeApi emailApi() => FakeApi()..authMethodsAnswer = const AuthMethods(email: true);

  testWidgets('offers no email sign-in while the server cannot mail codes', (tester) async {
    final h = await openSheet(tester);

    expect(find.text('Войти по почте'), findsNothing);
    await h.unmount(tester);
  });

  testWidgets('mails a code and signs in with the six digits from the letter', (tester) async {
    final api = emailApi();
    final h = await openSheet(tester, api: api);

    await requestCode(tester, ' Ivan@Mail.ru ');

    expect(api.emailStarts.single.toJson(), {'email': 'ivan@mail.ru', 'locale': 'ru'});
    expect(find.text('Отправили код на ivan@mail.ru. Он действует 10 минут.'), findsOneWidget);
    expect(find.text('Отправить ещё раз через 60 с'), findsOneWidget);
    final field = tester.widget<TextField>(codeField);
    expect(field.autofillHints, contains(AutofillHints.oneTimeCode));
    expect(field.keyboardType, TextInputType.number);

    // Six digits sign in without another tap.
    await tester.enterText(codeField, '042917');
    await settle(tester);

    expect(api.emailVerifications.single.toJson(), {'email': 'ivan@mail.ru', 'code': '042917'});
    expect(find.byType(SignInSheet), findsNothing);
    expect(h.container.read(currentUserProvider)?.email, 'ivan@mail.ru');
    await h.unmount(tester);
  });

  testWidgets('words a wrong code, offers another after a minute and lets the address be changed', (tester) async {
    final api = emailApi();
    final h = await openSheet(tester, api: api);
    await requestCode(tester);

    await tester.enterText(codeField, '111111');
    await brief(tester);
    expect(find.text('Неверный код. Осталось попыток: 4.'), findsOneWidget);
    expect(tester.widget<TextField>(codeField).controller?.text, isEmpty);
    expect(find.text('Отправить код ещё раз'), findsNothing);

    await tester.pump(const Duration(seconds: 60));
    await tester.tap(find.text('Отправить код ещё раз'));
    await brief(tester);
    expect(api.emailStarts, hasLength(2));
    expect(find.text('Отправить ещё раз через 60 с'), findsOneWidget);

    await tester.tap(find.text('Изменить почту'));
    await settle(tester, const Duration(milliseconds: 300));
    expect(codeField, findsNothing);
    expect(tester.widget<TextField>(addressField).controller?.text, 'ivan@mail.ru');
    await h.unmount(tester);
  });

  testWidgets('goes straight to the code when one went to the address a moment ago', (tester) async {
    final api = emailApi()..emailStartFailure = (429, {'code': 'EMAIL_CODE_COOLDOWN', 'retryAfterSeconds': 42});
    final h = await openSheet(tester, api: api);

    await requestCode(tester);

    expect(find.text('Код уже отправлен на ivan@mail.ru — проверьте почту.'), findsOneWidget);
    expect(find.text('Отправить ещё раз через 42 с'), findsOneWidget);
    expect(codeField, findsOneWidget);
    await h.unmount(tester);
  });

  testWidgets('words a refused letter and keeps the address to try again', (tester) async {
    final api = emailApi()..emailStartFailure = (503, {'code': 'EMAIL_CODE_NOT_SENT'});
    final h = await openSheet(tester, api: api);

    await requestCode(tester);

    expect(find.text('Не удалось отправить письмо. Попробуйте через несколько минут.'), findsOneWidget);
    expect(tester.widget<TextField>(addressField).controller?.text, 'ivan@mail.ru');
    await h.unmount(tester);
  });

  testWidgets('tells a staff address to use the password', (tester) async {
    final api = emailApi()..wrongCodeFailure = (401, {'code': 'EMAIL_LOGIN_STAFF_ACCOUNT'});
    final h = await openSheet(tester, api: api);
    await requestCode(tester);

    await tester.enterText(codeField, '000000');
    await brief(tester);

    expect(find.text('Этот адрес принадлежит сотруднику. Войдите с паролем в кабинете бизнеса.'), findsOneWidget);
    expect(h.container.read(isSignedInProvider), isFalse);
    await h.unmount(tester);
  });

  testWidgets('refuses an address without a domain before asking the server, and goes back', (tester) async {
    final api = emailApi();
    final h = await openSheet(tester, api: api);

    await requestCode(tester, 'ivan@mail');
    expect(find.textContaining('Проверьте адрес'), findsOneWidget);
    expect(api.emailStarts, isEmpty);

    await tester.tap(find.text('Другие способы входа'));
    await settle(tester, const Duration(milliseconds: 400));
    expect(find.text('Войти по почте'), findsOneWidget);
    expect(addressField, findsNothing);
    await h.unmount(tester);
  });
}
