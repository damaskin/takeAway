import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/app/router.dart';
import 'package:takeaway_mobile/features/cart/cart_line.dart';
import 'package:takeaway_mobile/features/menu/menu_search_screen.dart';
import 'package:takeaway_mobile/features/menu/product_card.dart';
import 'package:takeaway_mobile/features/product/option_widgets.dart';
import 'package:takeaway_mobile/features/product/product_screen.dart';
import 'package:takeaway_mobile/shared/store_kinds.dart';
import 'package:takeaway_mobile/shared/widgets/product_image.dart';
import 'package:takeaway_mobile/shared/widgets/store_map.dart';

import '../helpers/fake_api.dart';
import '../helpers/harness.dart';

Map<String, dynamic> _variation(String id, String type, String name, int delta, {bool def = false, int sort = 0}) => {
  'id': id,
  'type': type,
  'name': name,
  'priceDeltaCents': delta,
  'prepTimeDeltaSeconds': 0,
  'sortOrder': sort,
  'isDefault': def,
};

Map<String, dynamic> _addon(
  String id,
  String name,
  int delta, {
  String? group,
  int min = 0,
  int max = 1,
  int sort = 0,
}) => {
  'id': id,
  'slug': id,
  'name': name,
  'priceDeltaCents': delta,
  'minCount': min,
  'maxCount': max,
  'sortOrder': sort,
  'group': group,
};

/// A coffee shop menu with kinds: a cappuccino with every kind of option,
/// bakery (one item sold out) and a sandwich with a required sauce. With
/// [photos] the cappuccino and the croissant have one; nothing else does.
FakeApi _api({bool photos = false}) {
  Map<String, dynamic> pictured(Map<String, dynamic> json) => photos
      ? {
          ...json,
          'imageUrls': ['https://cdn.takeaway.md/products/${json['id']}.jpg'],
        }
      : json;
  final api = FakeApi();
  api.menuCategories = [
    {
      ...FakeApi.categoryJson('cat_coffee', 'Кофе', [
        pictured(FakeApi.productJson('p_capp', 'Капучино', 3000)),
        FakeApi.productJson('p_latte', 'Латте', 2000),
      ]),
      'kind': 'HOT_DRINKS',
    },
    {
      ...FakeApi.categoryJson('cat_bakery', 'Выпечка', [
        pictured(FakeApi.productJson('p_croissant', 'Круассан', 1500, category: 'cat_bakery')),
        {...FakeApi.productJson('p_eclair', 'Эклер', 1700, category: 'cat_bakery'), 'onStopList': true},
        FakeApi.productJson('p_muffin', 'Маффин', 1800, category: 'cat_bakery'),
      ], sortOrder: 1),
      'kind': 'BAKERY',
    },
    {
      ...FakeApi.categoryJson('cat_food', 'Еда', [
        FakeApi.productJson('p_sandwich', 'Сэндвич', 4500, category: 'cat_food'),
      ], sortOrder: 2),
      'kind': 'FOOD',
    },
  ];
  api.products['p_capp'] = ProductDetail.fromJson({
    ...pictured(FakeApi.productJson('p_capp', 'Капучино', 3000)),
    'categoryKind': 'HOT_DRINKS',
    'brandId': 'br_1',
    'allergens': ['MILK'],
    'variations': [
      _variation('v_s', 'SIZE', 'Малый', 0, def: true),
      _variation('v_m', 'SIZE', 'Средний', 300, sort: 1),
      _variation('v_cow', 'MILK', 'Коровье', 0, def: true),
      _variation('v_oat', 'MILK', 'Овсяное', 800, sort: 1),
    ],
    'modifiers': [
      _addon('m_vanilla', 'Ваниль', 500, group: 'Сиропы'),
      _addon('m_caramel', 'Карамель', 500, group: 'Сиропы', sort: 1),
      _addon('m_shot', 'Доп. шот', 600, max: 3, sort: 2),
    ],
  });
  api.products['p_sandwich'] = ProductDetail.fromJson({
    ...FakeApi.productJson('p_sandwich', 'Сэндвич', 4500, category: 'cat_food'),
    'categoryKind': 'FOOD',
    'brandId': 'br_1',
    'allergens': ['GLUTEN', 'EGGS', 'кунжут'],
    'variations': <Object>[],
    'modifiers': [
      _addon('m_ketchup', 'Кетчуп', 0, group: 'Соус', min: 1),
      _addon('m_cheese', 'Сырный', 700, group: 'Соус', sort: 1),
      _addon('m_onion', 'Без лука', 0, group: 'Убрать', sort: 2),
    ],
  });
  api.products['p_muffin'] = ProductDetail.fromJson({
    ...FakeApi.productJson('p_muffin', 'Маффин', 1800, category: 'cat_bakery'),
    'categoryKind': 'BAKERY',
    'brandId': 'br_1',
    'variations': [_variation('v_small', 'SIZE', 'Мини', 0, def: true), _variation('v_big', 'SIZE', 'Большой', 500)],
    'modifiers': <Object>[],
  });
  return api;
}

/// The harness sizes the surface to a phone but leaves MediaQuery at the test
/// default; the product screen sizes its photo from MediaQuery.
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

/// Any SVG picture. The app draws none: stand-in art for a product without a
/// photo got it rejected by App Review (Guideline 2.1(a)).
final _anySvg = find.byWidgetPredicate((w) => w.runtimeType.toString().contains('Svg'));

Finder _menuItem(String name) =>
    find.ancestor(of: find.text(name), matching: find.byWidgetPredicate((w) => w is ProductCard || w is ProductRow));

void main() {
  testWidgets('a drink: compact choices with prices, add-ons by group that open in place, live price', (tester) async {
    _phone(tester);
    final h = await pumpApp(tester, api: _api());
    await _openProduct(tester, h, 'p_capp');

    expect(find.text('Средний'), findsOneWidget);
    expect(find.text('+3\u00a0MDL'), findsOneWidget, reason: 'each choice shows what it adds');
    expect(find.text('+8\u00a0MDL'), findsOneWidget);
    expect(find.text('Малый · Коровье'), findsNWidgets(2), reason: 'under the title and by the button');
    expect(find.byTooltip('Кофеин'), findsOneWidget);
    expect(find.text('Содержит: молоко'), findsOneWidget);

    // Add-ons are closed rows, one per group.
    await _reveal(tester, find.text('Добавки · не выбрано'));
    expect(find.text('Сиропы · не выбрано'), findsOneWidget);
    expect(find.text('Ваниль'), findsNothing);

    await tester.tap(find.text('Сиропы · не выбрано'));
    await settle(tester, const Duration(milliseconds: 500));
    expect(find.text('Ваниль'), findsOneWidget);
    expect(find.text('+5\u00a0MDL'), findsNWidgets(2));
    await tester.tap(find.text('Ваниль'));
    await settle(tester, const Duration(milliseconds: 500));
    expect(find.text('Сиропы · Ваниль'), findsOneWidget);
    expect(find.text('35\u00a0MDL'), findsOneWidget, reason: '30 + 5 for the syrup');
    expect(find.text('Малый · Коровье · Ваниль'), findsNWidgets(2));

    // Opening another group closes this one.
    await tester.tap(find.text('Добавки · не выбрано'));
    await settle(tester, const Duration(milliseconds: 500));
    expect(find.text('Карамель'), findsNothing);
    expect(find.text('Доп. шот'), findsOneWidget);
    expect(find.text('до 3'), findsOneWidget);
    await tester.tap(find.descendant(of: find.byType(AddonGroupTile), matching: find.byIcon(Icons.add_rounded)));
    await settle(tester, const Duration(milliseconds: 500));
    expect(find.text('Добавки · Доп. шот'), findsOneWidget);
    expect(find.text('41\u00a0MDL'), findsOneWidget, reason: '30 + 5 + 6 for the shot');

    await tester.ensureVisible(find.text('Средний'));
    await tester.tap(find.text('Средний'));
    await settle(tester, const Duration(milliseconds: 500));
    expect(find.text('44\u00a0MDL'), findsOneWidget);

    await _reveal(tester, find.text('Пожелание бариста'));
    expect(find.text('Комментарий к заказу'), findsNothing);
    await _reveal(tester, find.text('Часто берут вместе'));
    expect(find.text('Круассан'), findsOneWidget);
    expect(find.text('Эклер'), findsNothing, reason: 'nothing sold out is suggested');

    await tester.tap(find.text('В корзину'));
    await settle(tester);
    final sent = h.api.added.single;
    expect(sent.variationIds, containsAll(<String>['v_m', 'v_cow']));
    expect(sent.modifiers, {'m_vanilla': 1, 'm_shot': 1});
    await h.unmount(tester);
  });

  testWidgets('food: a required sauce opens marked, no caffeine, allergens worded, an order comment', (tester) async {
    _phone(tester);
    final h = await pumpApp(tester, api: _api());
    await _openProduct(tester, h, 'p_sandwich');

    expect(find.byTooltip('Кофеин'), findsNothing, reason: 'the sandwich has a caffeine level, but it is food');
    expect(find.text('Содержит: глютен, яйца, кунжут'), findsOneWidget);
    await _reveal(tester, find.text('Убрать · не выбрано'));
    expect(find.text('Соус · Кетчуп'), findsOneWidget);
    expect(find.text('обязательно'), findsOneWidget);
    expect(find.text('Сырный'), findsOneWidget, reason: 'a required group starts open');
    final ketchup = tester.widget<Checkbox>(
      find.descendant(
        of: find.ancestor(of: find.text('Кетчуп'), matching: find.byType(InkWell)),
        matching: find.byType(Checkbox),
      ),
    );
    expect(ketchup.value, isTrue);
    expect(ketchup.onChanged, isNull, reason: 'a required add-on cannot be taken off');

    await _reveal(tester, find.text('Комментарий к заказу'));
    expect(find.text('Пожелание бариста'), findsNothing);
    expect(find.text('Часто берут вместе'), findsNothing, reason: 'pairing is offered under drinks');

    await tester.tap(find.text('В корзину'));
    await settle(tester);
    expect(h.api.added.single.modifiers, {'m_ketchup': 1});
    await h.unmount(tester);
  });

  testWidgets('the menu grids the products with a photo and lists the rest under them as text rows', (tester) async {
    _phone(tester);
    final h = await pumpApp(tester, api: _api(photos: true));

    expect(tester.widget(_menuItem('Капучино')), isA<ProductCard>());
    final latte = _menuItem('Латте');
    expect(tester.widget(latte), isA<ProductRow>());
    expect(find.descendant(of: latte, matching: find.byType(ProductImage)), findsNothing);
    expect(find.descendant(of: latte, matching: find.text('Двойной эспрессо и молоко.')), findsOneWidget);
    expect(find.descendant(of: latte, matching: find.text('20 MDL')), findsOneWidget);
    expect(find.descendant(of: latte, matching: find.byIcon(Icons.add_rounded)), findsOneWidget);
    expect(
      tester.getTopLeft(latte).dy,
      greaterThan(tester.getBottomLeft(_menuItem('Капучино')).dy),
      reason: 'rows come after the grid of photos',
    );
    expect(tester.getSize(latte).width, greaterThan(tester.getSize(_menuItem('Капучино')).width * 1.5));

    // A sold-out row says so instead of offering the «+».
    await tester.dragUntilVisible(find.text('Эклер'), find.byType(CustomScrollView).first, const Offset(0, -200));
    await settle(tester, const Duration(milliseconds: 300));
    final eclair = _menuItem('Эклер');
    expect(tester.widget(eclair), isA<ProductRow>());
    expect(find.descendant(of: eclair, matching: find.text('Закончилось')), findsOneWidget);
    expect(find.descendant(of: eclair, matching: find.byIcon(Icons.add_rounded)), findsNothing);

    // A category without a single photo is rows only.
    await tester.dragUntilVisible(find.text('Сэндвич'), find.byType(CustomScrollView).first, const Offset(0, -200));
    await settle(tester, const Duration(milliseconds: 300));
    expect(tester.widget(_menuItem('Сэндвич')), isA<ProductRow>());
    expect(_anySvg, findsNothing);

    // A row opens its product like a card does.
    await tester.tap(find.text('Сэндвич'));
    await settle(tester);
    expect(find.byType(ProductScreen), findsOneWidget);
    await h.unmount(tester);
  });

  testWidgets('a menu with no photos at all is rows only, with no stand-in art', (tester) async {
    _phone(tester);
    final h = await pumpApp(tester);
    expect(find.byType(ProductRow), findsWidgets);
    expect(find.byType(ProductCard), findsNothing);
    expect(find.byType(ProductImage), findsNothing);
    expect(_anySvg, findsNothing);
    await h.unmount(tester);
  });

  testWidgets('search shows a thumbnail only for a product with a photo', (tester) async {
    _phone(tester);
    final h = await pumpApp(tester, api: _api(photos: true));
    await tester.tap(find.byIcon(Icons.search_rounded));
    await settle(tester);
    expect(find.byType(MenuSearchScreen), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'Капучино');
    await settle(tester, const Duration(milliseconds: 300));
    expect(find.byType(ProductImage), findsOneWidget);

    await tester.enterText(find.byType(TextField), 'Латте');
    await settle(tester, const Duration(milliseconds: 300));
    expect(find.descendant(of: find.byType(ListView), matching: find.text('Латте')), findsOneWidget);
    expect(find.byType(ProductImage), findsNothing);
    expect(_anySvg, findsNothing);
    await h.unmount(tester);
  });

  testWidgets('a product without a photo opens on its name, with no picture block', (tester) async {
    _phone(tester);
    final h = await pumpApp(tester, api: _api());
    await _openProduct(tester, h, 'p_capp');

    expect(find.byType(FlexibleSpaceBar), findsNothing);
    expect(find.byType(ProductImage), findsNothing);
    expect(find.byWidgetPredicate((w) => w is Hero && w.tag == productHeroTag('p_capp')), findsNothing);
    final title = tester.getRect(find.text('Капучино').last);
    final close = tester.getRect(find.byIcon(Icons.close_rounded));
    expect(title.top, greaterThanOrEqualTo(close.bottom), reason: 'the name is not under the close button');
    expect(title.top, lessThan(140), reason: 'and starts right under the bar, not after an empty block');
    await h.unmount(tester);
  });

  testWidgets('a product with a photo opens on the photo, carried over from the menu card', (tester) async {
    _phone(tester);
    final h = await pumpApp(tester, api: _api(photos: true));
    await tester.tap(find.text('Капучино'));
    await settle(tester);

    expect(find.byType(ProductScreen), findsOneWidget);
    expect(find.byType(FlexibleSpaceBar), findsOneWidget);
    expect(find.byWidgetPredicate((w) => w is Hero && w.tag == productHeroTag('p_capp')), findsOneWidget);
    expect(find.descendant(of: find.byType(FlexibleSpaceBar), matching: find.byType(ProductImage)), findsOneWidget);
    final title = find.descendant(of: find.byType(ProductScreen), matching: find.text('Капучино'));
    expect(tester.getTopLeft(title).dy, greaterThan(300), reason: 'the photo comes first');
    await h.unmount(tester);
  });

  group('cart suggestions', () {
    Future<void> openCart(WidgetTester tester) async {
      await tester.tap(find.textContaining('позици'));
      await settle(tester);
    }

    testWidgets('a drink alone gets bakery and food to go with it, gone once something to eat is in', (tester) async {
      _phone(tester);
      final api = _api()..seedCart(FakeApi.latte());
      final h = await pumpApp(tester, api: api);
      await openCart(tester);

      expect(find.text('К заказу'), findsOneWidget);
      expect(find.text('Круассан'), findsOneWidget);
      expect(find.text('Маффин'), findsOneWidget);
      expect(find.text('Сэндвич'), findsOneWidget);
      expect(find.text('Эклер'), findsNothing, reason: 'sold out');
      expect(find.text('Латте'), findsOneWidget, reason: 'only the cart line, not a suggestion');
      expect(find.byType(ProductImage), findsNothing, reason: 'no photos here: lines and cards are text only');
      expect(_anySvg, findsNothing);

      await tester.tap(
        find.descendant(of: find.byKey(const ValueKey('p_croissant')), matching: find.byIcon(Icons.add_rounded)),
      );
      await settle(tester);
      expect(api.added.single.productId, 'p_croissant');
      expect(find.text('К заказу'), findsNothing);
      await h.unmount(tester);
    });

    testWidgets('suggestions and cart lines show a photo only when the product has one', (tester) async {
      _phone(tester);
      final api = _api(photos: true)..seedCart(FakeApi.latte());
      final h = await pumpApp(tester, api: api);
      await openCart(tester);

      final croissant = find.byKey(const ValueKey('p_croissant'));
      final muffin = find.byKey(const ValueKey('p_muffin'));
      expect(find.descendant(of: croissant, matching: find.byType(ProductImage)), findsOneWidget);
      expect(find.descendant(of: muffin, matching: find.byType(ProductImage)), findsNothing);
      expect(
        find.descendant(of: muffin, matching: find.text('Двойной эспрессо и молоко.')),
        findsOneWidget,
        reason: 'a text card says what it is instead',
      );
      Finder lineOf(String name) => find.ancestor(of: find.text(name), matching: find.byType(CartLine));
      expect(find.descendant(of: lineOf('Латте'), matching: find.byType(ProductImage)), findsNothing);

      await tester.tap(find.descendant(of: croissant, matching: find.byIcon(Icons.add_rounded)));
      await settle(tester);
      expect(find.descendant(of: lineOf('Круассан'), matching: find.byType(ProductImage)), findsOneWidget);
      expect(_anySvg, findsNothing);
      await h.unmount(tester);
    });

    testWidgets('the «+» of something with choices opens it instead', (tester) async {
      _phone(tester);
      final api = _api()..seedCart(FakeApi.latte());
      final h = await pumpApp(tester, api: api);
      await openCart(tester);

      await tester.tap(
        find.descendant(of: find.byKey(const ValueKey('p_muffin')), matching: find.byIcon(Icons.add_rounded)),
      );
      await settle(tester);
      expect(find.byType(ProductScreen), findsOneWidget);
      expect(find.descendant(of: find.byType(VariationChips), matching: find.text('Мини')), findsOneWidget);
      expect(api.added, isEmpty);
      await h.unmount(tester);
    });

    testWidgets('nothing is suggested next to food, or by an API without kinds', (tester) async {
      _phone(tester);
      final withFood = _api()
        ..seedCart(FakeApi.latte())
        ..seedCart(FakeApi.croissant());
      var h = await pumpApp(tester, api: withFood);
      await openCart(tester);
      expect(find.text('К заказу'), findsNothing);
      await h.unmount(tester);

      h = await pumpApp(tester, api: FakeApi()..seedCart(FakeApi.latte()));
      await openCart(tester);
      expect(find.text('Латте'), findsOneWidget);
      expect(find.text('К заказу'), findsNothing);
      await h.unmount(tester);
    });
  });

  group('checkout codes', () {
    Future<void> openCheckout(WidgetTester tester) async {
      await tester.tap(find.textContaining('позици'));
      await settle(tester);
      await tester.tap(find.textContaining('К оформлению'));
      await settle(tester);
    }

    Future<void> enter(WidgetTester tester, String label, String code) async {
      final field = find.widgetWithText(TextField, label);
      await _reveal(tester, field);
      await tester.enterText(field, code);
      await tester.testTextInput.receiveAction(TextInputAction.done);
      await settle(tester);
    }

    testWidgets('a refused promo code or gift card is worded in the app language', (tester) async {
      _phone(tester);
      final api = FakeApi()
        ..boundCards = [FakeApi.card()]
        ..flags = const FeatureFlags(agroprombankEnabled: true)
        ..seedCart(FakeApi.latte())
        ..promoAnswer = {
          'valid': false,
          'reason': 'This code is for customers who have not ordered for a while',
          'reasonCode': 'PROMO_NOT_ELIGIBLE',
          'discountCents': 0,
          'pointsMultiplier': 1,
        }
        ..giftCardRefusal = 'Gift card has expired';
      final h = await pumpApp(tester, api: api);
      await openCheckout(tester);

      await enter(tester, 'Промокод', 'BACK10');
      expect(find.text('Этот промокод — для тех, кто давно у нас не был'), findsOneWidget);
      expect(find.textContaining('have not ordered'), findsNothing);

      await enter(tester, 'Подарочная карта', 'GIFT1');
      expect(find.text('Срок действия карты истёк'), findsOneWidget);
      expect(find.textContaining('Gift card'), findsNothing);
      await h.unmount(tester);
    });

    testWidgets('a promo with a minimum order names the amount', (tester) async {
      _phone(tester);
      final api = FakeApi()
        ..boundCards = [FakeApi.card()]
        ..flags = const FeatureFlags(agroprombankEnabled: true)
        ..seedCart(FakeApi.latte())
        ..promoAnswer = {
          'valid': false,
          'reason': 'Minimum order is 50.00 MDL',
          'reasonCode': 'PROMO_MIN_ORDER',
          'minOrderCents': 5000,
          'currency': 'MDL',
          'discountCents': 0,
          'pointsMultiplier': 1,
        };
      final h = await pumpApp(tester, api: api);
      await openCheckout(tester);

      await enter(tester, 'Промокод', 'BIG');
      expect(find.text('Промокод действует при заказе от 50\u00a0MDL'), findsOneWidget);
      await h.unmount(tester);
    });
  });

  testWidgets('the order screen pictures its lines when they have photos and pins the store by what it sells', (
    tester,
  ) async {
    _phone(tester);
    Finder lineOf(String name) => find.ancestor(of: find.text(name), matching: find.byType(Row)).first;
    for (final photos in [true, false]) {
      final api = _api(photos: photos)
        ..storeKinds = ['FOOD']
        ..currentOrder = FakeApi.sampleOrder(storeLatitude: 46.84, storeLongitude: 29.63);
      final h = await pumpApp(tester, api: api);
      unawaited(h.container.read(routerProvider).push(Routes.order('ord_1')));
      await settle(tester);

      await _reveal(tester, find.text('Круассан'));
      expect(
        find.descendant(of: lineOf('Круассан'), matching: find.byType(ProductImage)),
        photos ? findsOneWidget : findsNothing,
        reason: photos ? 'the photo from the menu' : 'no photo, no thumbnail — and no stand-in',
      );
      expect(_anySvg, findsNothing);
      if (photos) {
        await _reveal(tester, find.byType(StorePin));
        expect(tester.widget<StorePin>(find.byType(StorePin)).kinds, {StoreKind.food});
      }
      await h.unmount(tester);
    }
  });
}
