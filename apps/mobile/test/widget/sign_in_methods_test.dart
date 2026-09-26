import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/app/router.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

void main() {
  testWidgets('shows which methods lead into the profile and disconnects Google', (tester) async {
    final api = FakeApi()..methods = const SignInMethods(telegram: true, google: true, apple: false);
    final h = await pumpApp(tester, api: api);
    unawaited(h.container.read(routerProvider).push(Routes.signInMethods));
    await settle(tester);

    expect(find.text('Способы входа'), findsOneWidget);
    expect(find.text('Подключён'), findsNWidgets(2));
    // Telegram stays: the Mini App signs in by it without asking.
    expect(find.text('Отключить'), findsOneWidget);

    await tester.tap(find.text('Отключить'));
    await settle(tester);
    expect(find.text('Отключить Google?'), findsOneWidget);
    await tester.tap(find.descendant(of: find.byType(AlertDialog), matching: find.text('Отключить')));
    await settle(tester);

    expect(api.unlinked, ['google']);
    expect(find.text('Подключён'), findsOneWidget);
    expect(find.text('Отключить'), findsNothing, reason: 'the last way in cannot be removed');
    await h.unmount(tester);
  });
}
