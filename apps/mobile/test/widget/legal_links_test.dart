import 'dart:async';

import 'package:flutter/gestures.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/shared/widgets/app_button.dart';

import '../helpers/harness.dart';

void main() {
  testWidgets('the sign-in sheet links the terms and the privacy policy', (tester) async {
    final h = await pumpApp(tester, signedIn: false);
    h.container.read(routerProvider).go(Routes.profile);
    await settle(tester);
    await tester.tap(find.widgetWithText(PrimaryButton, 'Войти'));
    await settle(tester);

    const sentence = 'Продолжая, вы соглашаетесь с Условиями использования и Политикой конфиденциальности.';
    expect(find.text(sentence), findsOneWidget);
    final links = <String>[];
    tester.widget<Text>(find.text(sentence)).textSpan!.visitChildren((span) {
      if (span is TextSpan && span.recognizer is TapGestureRecognizer) links.add(span.text!);
      return true;
    });
    expect(links, ['Условиями использования', 'Политикой конфиденциальности']);
    await h.unmount(tester);
  });

  testWidgets('about lists the privacy policy, the terms and support', (tester) async {
    final h = await pumpApp(tester);
    unawaited(h.container.read(routerProvider).push(Routes.about));
    await settle(tester);

    expect(find.text('Политика конфиденциальности'), findsOneWidget);
    expect(find.text('Условия использования'), findsOneWidget);
    expect(find.text('Поддержка'), findsOneWidget);
    await h.unmount(tester);
  });
}
