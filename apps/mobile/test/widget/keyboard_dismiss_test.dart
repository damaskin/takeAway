import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_mobile/shared/keyboard_dismiss.dart';

void main() {
  late FocusNode focus;

  Future<void> pumpForm(WidgetTester tester, {VoidCallback? onButton}) async {
    focus = FocusNode();
    addTearDown(focus.dispose);
    await tester.pumpWidget(
      MaterialApp(
        builder: (context, child) => DismissKeyboardOnTapOutside(child: child!),
        home: Scaffold(
          body: ListView(
            children: [
              TextField(key: const Key('name'), focusNode: focus),
              const TextField(key: Key('phone')),
              TextButton(onPressed: onButton ?? () {}, child: const Text('Button')),
              const SizedBox(height: 2000),
            ],
          ),
        ),
      ),
    );
    await tester.tap(find.byKey(const Key('name')));
    await tester.pump();
    expect(focus.hasFocus, isTrue);
    expect(tester.testTextInput.isVisible, isTrue);
  }

  testWidgets('tapping empty space closes the keyboard', (tester) async {
    await pumpForm(tester);

    await tester.tapAt(const Offset(200, 500));
    // The keyboard is hidden at the end of the frame the field let go in.
    await tester.pumpAndSettle();

    expect(focus.hasFocus, isFalse);
    expect(tester.testTextInput.isVisible, isFalse);
  });

  testWidgets('tapping a button closes the keyboard and still presses the button', (tester) async {
    var pressed = false;
    await pumpForm(tester, onButton: () => pressed = true);

    await tester.tap(find.text('Button'));
    await tester.pump();

    expect(pressed, isTrue);
    expect(focus.hasFocus, isFalse);
  });

  testWidgets('scrolling the form keeps the keyboard up', (tester) async {
    await pumpForm(tester);

    await tester.dragFrom(const Offset(200, 500), const Offset(0, -200));
    await tester.pump();

    expect(focus.hasFocus, isTrue);
  });

  testWidgets('tapping the next field moves focus there with the keyboard up', (tester) async {
    await pumpForm(tester);

    await tester.tap(find.byKey(const Key('phone')));
    await tester.pump();

    expect(focus.hasFocus, isFalse);
    expect(tester.testTextInput.isVisible, isTrue);
  });

  testWidgets('tapping inside the focused field keeps it focused', (tester) async {
    await pumpForm(tester);

    await tester.tap(find.byKey(const Key('name')));
    await tester.pump();

    expect(focus.hasFocus, isTrue);
  });
}
