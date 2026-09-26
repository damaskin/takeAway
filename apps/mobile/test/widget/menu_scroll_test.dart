import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

void main() {
  testWidgets('scrolling into the next category leaves the menu where the customer scrolled it', (tester) async {
    final api = FakeApi()
      ..menuCategories = [
        for (var c = 0; c < 5; c++)
          FakeApi.categoryJson('cat_$c', 'Категория $c', [
            for (var p = 0; p < 8; p++) FakeApi.productJson('p_${c}_$p', 'Позиция $c.$p', 1000, category: 'cat_$c'),
          ], sortOrder: c),
      ];
    final h = await pumpApp(tester, api: api);

    final menu = find.byType(CustomScrollView).first;
    final position = tester
        .state<ScrollableState>(find.descendant(of: menu, matching: find.byType(Scrollable)).first)
        .position;

    // A finger scrolling down frame by frame, the way the scroll-spy sees it,
    // well past the point where the second category reaches the pinned bar.
    final finger = await tester.startGesture(tester.getCenter(menu));
    for (var step = 0; step < 14; step++) {
      await finger.moveBy(const Offset(0, -150));
      await tester.pump(const Duration(milliseconds: 16));
    }
    final scrolled = position.pixels;
    await tester.pump(const Duration(milliseconds: 200));
    await finger.up();
    await settle(tester);

    expect(scrolled, greaterThan(1800), reason: 'the drag itself was cut short');
    expect(
      position.pixels,
      greaterThanOrEqualTo(scrolled - 1),
      reason: 'highlighting the next category must not scroll the menu back up',
    );

    await h.unmount(tester);
  });
}
