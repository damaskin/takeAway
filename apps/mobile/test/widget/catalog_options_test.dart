import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/features/menu/product_card.dart';
import 'package:takeaway_mobile/features/product/product_screen.dart';

import '../helpers/catalog_fixtures.dart';
import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

// The product screen on the options catalog («Добавки и варианты», Maxim's
// list 5.0 item 17): the acceptance points of the spec (§10) that the app
// shows, and the cart, checkout and order lines that carry the choice.

void _phone(WidgetTester tester) {
  tester.view
    ..physicalSize = const Size(412, 915)
    ..devicePixelRatio = 1;
  addTearDown(tester.view.reset);
}

Future<void> _openProduct(WidgetTester tester, Harness h, String id) async {
  unawaited(h.container.read(routerProvider).push(Routes.product(id)));
  await settle(tester);
}

Future<void> _reveal(WidgetTester tester, Finder finder) async {
  await tester.scrollUntilVisible(finder, 200, scrollable: find.byType(Scrollable).first);
  await tester.ensureVisible(finder);
  await settle(tester, const Duration(milliseconds: 400));
}

Future<void> _tap(WidgetTester tester, Finder finder) async {
  await _reveal(tester, finder);
  await tester.tap(finder);
  await settle(tester, const Duration(milliseconds: 500));
}

Finder _row(String optionId) => find.byKey(ValueKey('option-$optionId'));

Finder _in(String optionId, Finder what) => find.descendant(of: _row(optionId), matching: what);

/// The add button of the product screen.
FilledButton _addButton(WidgetTester tester) =>
    tester.widget<FilledButton>(find.widgetWithText(FilledButton, 'В корзину'));

Finder _hint(String text) =>
    find.descendant(of: find.byKey(const ValueKey('bar-hint')), matching: find.text(text), matchRoot: true);

void main() {
  testWidgets('a required size keeps the button off and says so; the price follows every pick', (tester) async {
    _phone(tester);
    final h = await pumpApp(tester, api: catalogApi());
    await _openProduct(tester, h, 'p_capp');

    // Variants first, each with its note and what it adds or takes off.
    expect(find.text('Размер (кофе)'), findsOneWidget);
    expect(find.text('300–350 мл'), findsOneWidget);
    expect(_in('o_s', find.text('−5 MDL')), findsOneWidget);
    expect(_in('o_l', find.text('+7 MDL')), findsOneWidget);
    expect(_in('o_m', find.textContaining('MDL')), findsNothing, reason: 'the base size adds nothing');
    expect(
      tester.getTopLeft(find.text('Размер (кофе)')).dy,
      lessThan(tester.getTopLeft(find.text('Молоко')).dy),
      reason: 'variants come before add-ons',
    );

    // Nothing picked for the size: the button is off and says what is missing.
    expect(_hint('Выберите: Размер (кофе)'), findsOneWidget);
    expect(find.text('обязательно'), findsOneWidget);
    expect(_addButton(tester).onPressed, isNull);
    expect(find.text('45 MDL'), findsOneWidget, reason: 'the base price until a size is picked');

    await _tap(tester, find.text('M'));
    expect(find.byKey(const ValueKey('bar-hint')), findsNothing);
    expect(find.text('обязательно'), findsNothing);
    expect(_addButton(tester).onPressed, isNotNull);
    expect(find.text('M, Горячий · Коровье'), findsNWidgets(2), reason: 'under the title and by the button');

    await _tap(tester, find.text('L'));
    expect(find.text('52 MDL'), findsOneWidget, reason: 'L adds 7');
    await _tap(tester, find.text('S'));
    expect(find.text('40 MDL'), findsOneWidget, reason: 'S takes 5 off');
    await _tap(tester, find.text('M'));

    // An add-on with its price; the one that ran out is greyed and stays off.
    expect(_in('o_coconut', find.text('Нет в наличии')), findsOneWidget);
    await _tap(tester, find.text('Кокосовое'));
    expect(find.text('M, Горячий · Коровье'), findsNWidgets(2));
    await _tap(tester, find.text('Овсяное'));
    expect(find.text('55 MDL'), findsOneWidget);

    // Up to two syrups: a third is refused.
    expect(find.text('до 2'), findsOneWidget);
    await _tap(tester, find.text('Ваниль'));
    await _tap(tester, find.text('Солёная карамель'));
    expect(find.text('71 MDL'), findsOneWidget);
    final hazelnut = tester.widget<Checkbox>(_in('o_hazelnut', find.byType(Checkbox)));
    expect(hazelnut.value, isFalse);
    expect(hazelnut.onChanged, isNull, reason: 'greyed once two are picked');
    await _tap(tester, find.text('Лесной орех'));
    expect(tester.widget<Checkbox>(_in('o_hazelnut', find.byType(Checkbox))).value, isFalse);
    expect(find.text('71 MDL'), findsOneWidget, reason: 'the third syrup did not go in');

    // Sugar counts, free.
    await _reveal(tester, _row('o_sugar'));
    for (var i = 0; i < 2; i++) {
      await tester.tap(_in('o_sugar', find.byIcon(Icons.add_rounded)));
      await settle(tester, const Duration(milliseconds: 300));
    }
    expect(find.text(cappuccinoExampleText), findsNWidgets(2));
    expect(find.text('71 MDL'), findsOneWidget, reason: 'the spec example: 45 + 10 + 8 + 8');

    // A switch with its price.
    await _tap(tester, find.text('Корица'));
    expect(find.text('73 MDL'), findsOneWidget);
    await _tap(tester, find.text('Корица'));

    await tester.tap(find.text('В корзину'));
    await settle(tester);
    final sent = h.api.added.single;
    expect(sent.options, toOptionSelections(cappuccinoExample));
    expect(sent.variationIds, isNull, reason: 'the older options are left out');
    expect(sent.modifiers, isNull);
    expect(find.byType(ProductScreen), findsNothing, reason: 'back to the menu');
    await h.unmount(tester);
  });

  testWidgets('ice and foam show for an iced coffee and leave with their picks when it is hot again', (tester) async {
    _phone(tester);
    final h = await pumpApp(tester, api: catalogApi());
    await _openProduct(tester, h, 'p_capp');
    await _tap(tester, find.text('M'));

    expect(find.byKey(const ValueKey('option-o_ice')), findsNothing);
    expect(find.text('Пенка-топ'), findsNothing);

    await _tap(tester, find.text('Холодный'));
    expect(find.text('Пенка-топ'), findsOneWidget);
    await _reveal(tester, _row('o_ice'));
    expect(_in('o_ice', find.text('+1 MDL за шт.')), findsOneWidget, reason: 'priced per unit');
    for (var i = 0; i < 2; i++) {
      await tester.tap(_in('o_ice', find.byIcon(Icons.add_rounded)));
      await settle(tester, const Duration(milliseconds: 300));
    }
    expect(find.text('47 MDL'), findsOneWidget);
    expect(find.text('M, Холодный · Коровье · Лёд ×2'), findsNWidgets(2));

    await _tap(tester, find.text('Горячий'));
    expect(find.byKey(const ValueKey('option-o_ice')), findsNothing);
    expect(find.text('Пенка-топ'), findsNothing);
    expect(find.text('45 MDL'), findsOneWidget, reason: 'the ice went with its group');

    await tester.tap(find.text('В корзину'));
    await settle(tester);
    expect(h.api.added.single.options, toOptionSelections({'o_m': 1, 'o_hot': 1, 'o_cow': 1}));
    await h.unmount(tester);
  });

  testWidgets('meat: the included portion is free, never below one, the second costs one portion', (tester) async {
    _phone(tester);
    final h = await pumpApp(tester, api: catalogApi());
    await _openProduct(tester, h, 'p_shawarma');

    expect(_addButton(tester).onPressed, isNotNull, reason: 'the defaults are a full choice');
    expect(find.text('150 MDL'), findsOneWidget);
    await _reveal(tester, _row('o_meat'));
    expect(_in('o_meat', find.text('1 в цене · +25 MDL за шт.')), findsOneWidget);
    expect(_in('o_meat', find.text('1')), findsOneWidget);

    await tester.tap(_in('o_meat', find.byIcon(Icons.remove_rounded)));
    await settle(tester, const Duration(milliseconds: 500));
    expect(_in('o_meat', find.text('1')), findsOneWidget, reason: 'not below one');

    await tester.tap(_in('o_meat', find.byIcon(Icons.add_rounded)));
    await settle(tester, const Duration(milliseconds: 500));
    expect(find.text('175 MDL'), findsOneWidget);
    expect(find.text('Курица · Мясо / котлета ×2'), findsNWidgets(2));

    // Falafel has run out: greyed, «Нет в наличии», the tap does nothing.
    expect(_in('o_falafel', find.text('Нет в наличии')), findsOneWidget);
    await _tap(tester, find.text('Фалафель'));
    expect(find.text('Курица · Мясо / котлета ×2'), findsNWidgets(2));

    await _tap(tester, find.text('Без лука'));
    expect(find.text('Курица · Мясо / котлета ×2 · Без лука'), findsNWidgets(2));

    await tester.tap(find.text('В корзину'));
    await settle(tester);
    expect(h.api.added.single.options, const [
      OptionSelection(optionId: 'o_chicken', qty: 1),
      OptionSelection(optionId: 'o_meat', qty: 2),
      OptionSelection(optionId: 'o_no_onion', qty: 1),
    ]);
    await h.unmount(tester);
  });

  testWidgets('the menu «+» opens what needs a choice and adds what its defaults make whole', (tester) async {
    _phone(tester);
    final h = await pumpApp(tester, api: catalogApi());
    Finder plusOf(String name) => find.descendant(
      of: find.ancestor(
        of: find.text(name),
        matching: find.byWidgetPredicate((w) => w is ProductCard || w is ProductRow),
      ),
      matching: find.byIcon(Icons.add_rounded),
    );

    await tester.tap(plusOf('Капучино'));
    await settle(tester);
    expect(find.byType(ProductScreen), findsOneWidget, reason: 'the menu says it needs a size');
    expect(h.api.added, isEmpty);
    h.container.read(routerProvider).pop();
    await settle(tester);

    await tester.dragUntilVisible(find.text('Шаурма'), find.byType(CustomScrollView).first, const Offset(0, -200));
    await settle(tester, const Duration(milliseconds: 300));
    await tester.tap(plusOf('Шаурма'));
    await settle(tester);
    expect(find.byType(ProductScreen), findsNothing);
    expect(h.api.added.single.options, const [
      OptionSelection(optionId: 'o_chicken', qty: 1),
      OptionSelection(optionId: 'o_meat', qty: 1),
    ], reason: 'with its defaults');
    await h.unmount(tester);
  });

  testWidgets('a choice the cart refuses is worded, and the product is fetched again', (tester) async {
    _phone(tester);
    final api = catalogApi();
    final h = await pumpApp(tester, api: api);
    await _openProduct(tester, h, 'p_shawarma');
    expect(_addButton(tester).onPressed, isNotNull);

    // The chicken runs out while the customer looks at the page.
    api.soldOut.add('o_chicken');
    await tester.tap(find.text('В корзину'));
    await settle(tester);
    expect(find.text('Что-то из выбранного только что закончилось — выберите другое'), findsOneWidget);
    expect(find.textContaining('Options do not match'), findsNothing);
    expect(find.byType(ProductScreen), findsOneWidget);

    await _reveal(tester, _row('o_chicken'));
    expect(_in('o_chicken', find.text('Нет в наличии')), findsOneWidget, reason: 'the fresh copy shows it');
    expect(_hint('Выберите: Мясо'), findsOneWidget);
    expect(_addButton(tester).onPressed, isNull);
    await _tap(tester, find.text('Говядина'));
    expect(_addButton(tester).onPressed, isNotNull);
    expect(find.text('165 MDL'), findsOneWidget);
    await h.unmount(tester);
  });

  testWidgets('the cart and checkout read the choice as the kitchen does, and undo puts it back', (tester) async {
    _phone(tester);
    final api = catalogApi()
      ..boundCards = [FakeApi.card()]
      ..flags = const FeatureFlags(agroprombankEnabled: true)
      ..seedCart(cappuccino(), picks: cappuccinoExample);
    final h = await pumpApp(tester, api: api);
    unawaited(h.container.read(routerProvider).push(Routes.cart));
    await settle(tester);

    expect(find.text(cappuccinoExampleText), findsOneWidget);
    expect(find.text('71 MDL'), findsWidgets);

    await tester.tap(find.textContaining('К оформлению'));
    await settle(tester);
    await _reveal(tester, find.text(cappuccinoExampleText));
    expect(find.text('1 × Капучино'), findsOneWidget);
    h.container.read(routerProvider).pop();
    await settle(tester);

    await tester.drag(find.text('Капучино'), const Offset(-500, 0));
    await settle(tester, const Duration(milliseconds: 1000));
    await tester.tap(find.text('Вернуть'));
    await settle(tester, const Duration(seconds: 4));
    expect(api.added.single.options, toOptionSelections(cappuccinoExample), reason: 'the same choice comes back');
    expect(find.text(cappuccinoExampleText), findsOneWidget);
    await h.unmount(tester);
  });

  testWidgets('an order line reads its choice, and a repeat orders the same', (tester) async {
    _phone(tester);
    final lines = optionLinesFor(orderOptionGroups(cappuccino().optionGroups), {'o_m': 1, 'o_hot': 1, 'o_oat': 1});
    final api = catalogApi()
      ..currentOrder = FakeApi.sampleOrder(
        status: 'PICKED_UP',
        items: [
          {
            'id': 'it_1',
            'productSnapshot': {
              'id': 'p_capp',
              'name': 'Капучино',
              'variationIds': <String>[],
              'modifiers': <String, int>{},
              'optionLines': [for (final line in lines) line.toJson()],
            },
            'quantity': 1,
            'unitPriceCents': 5500,
            'totalCents': 5500,
          },
        ],
      );
    final h = await pumpApp(tester, api: api);
    unawaited(h.container.read(routerProvider).push(Routes.order('ord_1')));
    await settle(tester);

    await _reveal(tester, find.text('M, Горячий · Овсяное'));
    await _tap(tester, find.byKey(const ValueKey('reorder')));
    await settle(tester);
    expect(api.added.single.options, toOptionSelections({'o_m': 1, 'o_hot': 1, 'o_oat': 1}));
    await h.unmount(tester);
  });
}
