import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/features/profile/feedback_screen.dart';
import 'package:takeaway_mobile/features/profile/profile_screen.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

void main() {
  Future<Harness> openProfile(WidgetTester tester, {FakeApi? api}) async {
    final h = await pumpApp(tester, api: api, overrides: [appVersionProvider.overrideWith((ref) async => '1.2.0 (3)')]);
    h.container.read(routerProvider).go(Routes.profile);
    await settle(tester);
    await tester.scrollUntilVisible(
      find.text('Обратная связь'),
      300,
      scrollable: find.descendant(of: find.byType(ProfileScreen), matching: find.byType(Scrollable)).first,
    );
    await settle(tester, const Duration(milliseconds: 300));
    return h;
  }

  Future<void> openForm(WidgetTester tester) async {
    await tester.tap(find.text('Обратная связь'));
    await settle(tester);
    expect(find.byType(FeedbackScreen), findsOneWidget);
  }

  Finder field(String label) => find.widgetWithText(TextFormField, label);

  String location(Harness h) => h.container.read(routerProvider).routerDelegate.currentConfiguration.uri.path;

  testWidgets('sends a problem report with the contact and the app version, then thanks', (tester) async {
    final h = await openProfile(tester);
    await openForm(tester);

    await tester.tap(find.text('Проблема'));
    await settle(tester, const Duration(milliseconds: 300));
    expect(find.text('Что случилось? Если это про заказ — укажите его номер.'), findsOneWidget);

    await tester.enterText(field('Сообщение'), '  Кофе был холодный, заказ #A12  ');
    await tester.enterText(field('Как с вами связаться (необязательно)'), ' @ivan ');
    await tester.tap(find.text('Отправить'));
    await settle(tester);

    expect(h.api.feedback, hasLength(1));
    final sent = h.api.feedback.single;
    expect(sent.kind, FeedbackKind.problem);
    expect(sent.message, 'Кофе был холодный, заказ #A12');
    expect(sent.contact, '@ivan');
    expect(sent.source, FeedbackSource.android, reason: 'tests run as Android');
    expect(sent.appVersion, '1.2.0 (3)');

    expect(find.text('Спасибо!'), findsOneWidget);
    await tester.tap(find.text('Готово'));
    await settle(tester);
    expect(location(h), Routes.profile);
    await h.unmount(tester);
  });

  testWidgets('asks for a message before sending and leaves out a blank contact', (tester) async {
    final h = await openProfile(tester);
    await openForm(tester);

    await tester.tap(find.text('Отправить'));
    await settle(tester, const Duration(milliseconds: 300));
    expect(find.text('Напишите пару слов'), findsOneWidget);
    expect(h.api.feedback, isEmpty);

    await tester.enterText(field('Сообщение'), 'Добавьте овсяное молоко');
    await tester.tap(find.text('Отправить'));
    await settle(tester);

    expect(h.api.feedback.single.kind, FeedbackKind.suggestion, reason: 'suggestion is the default');
    expect(h.api.feedback.single.contact, isNull);
    expect(h.api.feedback.single.toJson().containsKey('contact'), isFalse);
    await h.unmount(tester);
  });

  testWidgets('explains the hourly limit and keeps the text for a later try', (tester) async {
    final h = await openProfile(tester, api: FakeApi()..feedbackStatus = 429);
    await openForm(tester);

    await tester.enterText(field('Сообщение'), 'Спасибо за быстрый кофе');
    await tester.tap(find.text('Отправить'));
    await settle(tester);

    expect(find.text('Слишком много сообщений подряд. Попробуйте через час.'), findsOneWidget);
    expect(find.text('Спасибо!'), findsNothing);
    expect(find.text('Спасибо за быстрый кофе'), findsOneWidget);

    h.api.feedbackStatus = null;
    await tester.tap(find.text('Отправить'));
    await settle(tester);
    expect(h.api.feedback, hasLength(2));
    expect(find.text('Спасибо!'), findsOneWidget);
    await h.unmount(tester);
  });

  testWidgets('a guest sees no feedback row and cannot open the form', (tester) async {
    final h = await pumpApp(tester, signedIn: false);
    h.container.read(routerProvider).go(Routes.profile);
    await settle(tester);
    expect(find.text('Обратная связь'), findsNothing);

    h.container.read(routerProvider).go(Routes.feedback);
    await settle(tester);
    expect(location(h), Routes.profile);
    expect(find.byType(FeedbackScreen), findsNothing);
    await h.unmount(tester);
  });
}
