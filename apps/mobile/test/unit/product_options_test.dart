import 'package:flutter/widgets.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:takeaway_api/takeaway_api.dart';
import 'package:takeaway_mobile/features/cart/upsell.dart';
import 'package:takeaway_mobile/features/menu/quick_add.dart';
import 'package:takeaway_mobile/features/product/product_options.dart';
import 'package:takeaway_mobile/l10n/app_localizations.dart';
import 'package:takeaway_mobile/shared/checkout_errors.dart';
import 'package:takeaway_mobile/shared/product_kinds.dart';
import 'package:takeaway_mobile/shared/widgets/chips.dart';

import '../helpers/fake_api.dart';

Map<String, dynamic> variation(String id, String type, String name, {int delta = 0, bool def = false, int sort = 0}) =>
    {
      'id': id,
      'type': type,
      'name': name,
      'priceDeltaCents': delta,
      'prepTimeDeltaSeconds': 0,
      'sortOrder': sort,
      'isDefault': def,
    };

Map<String, dynamic> addon(String id, String name, {String? group, int min = 0, int max = 1, int sort = 0}) => {
  'id': id,
  'slug': id,
  'name': name,
  'priceDeltaCents': 500,
  'minCount': min,
  'maxCount': max,
  'sortOrder': sort,
  'group': group,
};

ProductDetail detail({
  List<Map<String, dynamic>> variations = const [],
  List<Map<String, dynamic>> modifiers = const [],
  String? kind,
}) => ProductDetail.fromJson({
  ...FakeApi.productJson('p', 'Капучино', 3000),
  'brandId': 'br_1',
  'categoryKind': kind,
  'variations': variations,
  'modifiers': modifiers,
});

Menu menu(List<(String id, String? kind, List<Map<String, dynamic>> products)> categories) => Menu.fromJson({
  'storeId': 'st_1',
  'storeSlug': 'st',
  'categories': [
    for (final (i, (id, kind, products)) in categories.indexed)
      {...FakeApi.categoryJson(id, id, products, sortOrder: i), 'kind': kind},
  ],
});

void main() {
  group('add-on groups', () {
    test('group add-ons by their display group, in menu order, the ungrouped ones together', () {
      final groups = addonGroups(
        detail(
          modifiers: [
            addon('shot', 'Шот', sort: 2, max: 3),
            addon('caramel', 'Карамель', group: 'Сиропы', sort: 1),
            addon('vanilla', 'Ваниль', group: 'Сиропы'),
            addon('sugar', 'Без сахара', group: 'Убрать', sort: 3),
            addon('cinnamon', 'Корица', sort: 4),
          ],
        ),
      );
      expect(groups.map((g) => g.name), ['Сиропы', null, 'Убрать']);
      expect(groups.first.modifiers.map((m) => m.id), ['vanilla', 'caramel']);
      expect(groups[1].modifiers.map((m) => m.id), ['shot', 'cinnamon']);
      expect(groups.map((g) => g.key), ['Сиропы', '', 'Убрать']);
    });

    test('a group with an add-on that has to be taken is required', () {
      final groups = addonGroups(
        detail(
          modifiers: [
            addon('ketchup', 'Кетчуп', group: 'Соус', min: 1),
            addon('cheese', 'Сырный', group: 'Соус', sort: 1),
            addon('onion', 'Без лука', group: 'Убрать', sort: 2),
          ],
        ),
      );
      expect(groups.map((g) => g.isRequired), [true, false]);
    });

    test('say what is taken from a group, with counts', () {
      final group = addonGroups(
        detail(
          modifiers: [
            addon('vanilla', 'Ваниль', group: 'Сиропы'),
            addon('caramel', 'Карамель', group: 'Сиропы', sort: 1, max: 3),
          ],
        ),
      ).single;
      expect(addonGroupSummary(group, {}), '');
      expect(addonGroupSummary(group, {'vanilla': 1, 'caramel': 2}), 'Ваниль, 2× Карамель');
    });
  });

  group('options summary', () {
    final product = detail(
      variations: [
        variation('oat', 'MILK', 'Овсяное', sort: 1),
        variation('cow', 'MILK', 'Коровье', def: true),
        variation('l', 'SIZE', 'Большой', sort: 1),
        variation('s', 'SIZE', 'Малый', def: true),
        variation('paper', 'CUP', 'Бумажный', def: true),
      ],
      modifiers: [
        addon('shot', 'Шот', max: 3),
        addon('vanilla', 'Ваниль', group: 'Сиропы', sort: 1),
      ],
    );

    test('lists the size first, then the other choices and the add-ons', () {
      expect(
        optionsSummary(product, ['oat', 'l', 'paper'], {'vanilla': 1, 'shot': 2}),
        'Большой · Овсяное · Бумажный · 2× Шот · Ваниль',
      );
    });

    test('leaves out what could not be chosen when asked to', () {
      expect(optionsSummary(product, ['oat', 'l', 'paper'], {}, onlyChoices: true), 'Большой · Овсяное');
    });

    test('is empty until the product details arrive', () {
      expect(optionsSummary(null, ['l'], {'shot': 1}), '');
    });
  });

  test('a product with a size or a required add-on opens its screen instead of a quick add', () {
    expect(needsChoosing(detail()), isFalse);
    expect(needsChoosing(detail(modifiers: [addon('shot', 'Шот')])), isFalse);
    expect(needsChoosing(detail(modifiers: [addon('ketchup', 'Кетчуп', min: 1)])), isTrue);
    expect(needsChoosing(detail(variations: [variation('s', 'SIZE', 'S', def: true)])), isTrue);
  });

  group('product kinds', () {
    test('read the kinds the API names, in any case, and nothing else', () {
      expect(ProductKind.tryParse('BAKERY'), ProductKind.bakery);
      expect(ProductKind.tryParse(' cold_drinks '), ProductKind.coldDrinks);
      expect(ProductKind.tryParse('SOUP'), isNull);
      expect(ProductKind.tryParse(null), isNull);
    });

    test("take the product's own kind, else its category's", () {
      final m = menu([
        ('cat_food', 'FOOD', [FakeApi.productJson('p_wrap', 'Ролл', 4000, category: 'cat_food')]),
        ('cat_misc', null, [FakeApi.productJson('p_bag', 'Пакет', 100, category: 'cat_misc')]),
      ]);
      final wrap = m.allProducts.first;
      expect(productKindOf(wrap, menu: m), ProductKind.food);
      expect(productKindOf(wrap, categoryKind: 'BAKERY'), ProductKind.bakery);
      expect(productKindOf(detail(kind: 'HOT_DRINKS'), categoryKind: 'FOOD'), ProductKind.hotDrinks);
      expect(productKindOf(m.allProducts.last, menu: m), isNull, reason: 'an API without kinds');
      expect(ProductKind.food.placeholderAsset, 'assets/product-placeholders/food.svg');
      expect(ProductKind.coldDrinks.placeholderAsset, 'assets/product-placeholders/cold-drink.svg');
    });
  });

  group('upsell', () {
    Map<String, dynamic> p(String id, {bool soldOut = false, String category = 'c'}) => {
      ...FakeApi.productJson(id, id, 1000, category: category),
      'onStopList': soldOut,
    };

    final m = menu([
      ('cat_coffee', 'HOT_DRINKS', [p('latte', category: 'cat_coffee')]),
      ('cat_food', 'FOOD', [p('wrap', category: 'cat_food'), p('soup', soldOut: true, category: 'cat_food')]),
      (
        'cat_bakery',
        'BAKERY',
        [
          for (final id in ['croissant', 'muffin', 'cookie', 'bun', 'tart']) p(id, category: 'cat_bakery'),
        ],
      ),
      ('cat_other', 'OTHER', [p('bag', category: 'cat_other')]),
    ]);

    Cart cart(List<String> productIds) => Cart(
      id: 'cart',
      userId: 'u1',
      storeId: 'st_1',
      subtotalCents: 0,
      etaSeconds: 0,
      items: [
        for (final id in productIds)
          CartItem(
            id: 'ci_$id',
            productId: id,
            productName: id,
            quantity: 1,
            variationIds: const [],
            modifiers: const {},
            unitPriceCents: 1000,
            unitPrepSeconds: 0,
          ),
      ],
      updatedAt: DateTime.utc(2026, 10, 11),
    );

    test('offers bakery first, then food, up to six, nothing sold out', () {
      expect(foodSuggestions(m).map((s) => s.product.id), ['croissant', 'muffin', 'cookie', 'bun', 'tart', 'wrap']);
      expect(foodSuggestions(m, exclude: {'muffin'}, limit: 3).map((s) => s.product.id), [
        'croissant',
        'cookie',
        'bun',
      ]);
      expect(foodSuggestions(m).first.kind, ProductKind.bakery);
    });

    test('wants food only for a cart with a drink and nothing to eat', () {
      expect(wantsFood(cart(['latte']), m), isTrue);
      expect(wantsFood(cart(['latte', 'croissant']), m), isFalse);
      expect(wantsFood(cart(['bag']), m), isFalse);
      expect(wantsFood(cart(['gone']), m), isFalse, reason: 'a line the menu no longer lists says nothing');
    });

    test('a menu without kinds suggests nothing and wants nothing', () {
      final older = menu([
        ('cat_coffee', null, [p('latte', category: 'cat_coffee')]),
        ('cat_food', null, [p('wrap', category: 'cat_food')]),
      ]);
      expect(foodSuggestions(older), isEmpty);
      expect(wantsFood(cart(['latte']), older), isFalse);
    });
  });

  group('words', () {
    final ru = lookupAppLocalizations(const Locale('ru'));
    final en = lookupAppLocalizations(const Locale('en'));

    test('allergen codes in the language of the app, free text as it is', () {
      expect(
        allergensText(ru, ['GLUTEN', 'milk', 'SULFITES', 'орехи пекан', ' ', 'GLUTEN']),
        'глютен, молоко, сульфиты, орехи пекан',
      );
      expect(allergensText(en, ['EGGS', 'SHELLFISH']), 'eggs, shellfish');
    });

    testWidgets('order-path codes with what they need, and none for an unknown code', (tester) async {
      late BuildContext context;
      await tester.pumpWidget(
        Localizations(
          locale: const Locale('ru'),
          delegates: AppLocalizations.localizationsDelegates,
          child: Builder(
            builder: (c) {
              context = c;
              return const SizedBox();
            },
          ),
        ),
      );
      expect(
        checkoutErrorText(context, 'ITEMS_UNAVAILABLE', {
          'items': ['Латте', 'Круассан'],
        }),
        'Сейчас нет в наличии: Латте, Круассан',
      );
      expect(checkoutErrorText(context, 'ITEMS_UNAVAILABLE'), 'Часть позиций сейчас нет в наличии');
      expect(
        checkoutErrorText(context, 'PICKUP_TIME_OUT_OF_RANGE', {'minMinutes': 20, 'maxHours': 12}),
        'Ко времени можно заказать не раньше чем через 20 мин и не позже чем через 12 ч',
      );
      expect(
        checkoutErrorText(context, 'BELOW_MIN_ORDER', {'minOrderCents': 10000, 'currency': 'RUP'}),
        'Минимальная сумма заказа — 100 руб.',
      );
      expect(checkoutErrorText(context, 'PROMO_MIN_ORDER'), 'Для этого промокода сумма заказа слишком мала');
      expect(checkoutErrorText(context, 'PROMO_EXPIRED'), 'Срок действия промокода истёк');
      expect(checkoutErrorText(context, 'SOMETHING_NEW'), isNull);
      expect(checkoutErrorText(context, null), isNull);
    });

    test('gift card refusals the API words in English', () {
      expect(giftCardErrorText(ru, 'Gift card not found'), 'Такой подарочной карты нет');
      expect(giftCardErrorText(ru, 'Gift card is not valid at this brand'), 'Эта карта не действует в этом заведении');
      expect(
        giftCardErrorText(ru, 'Gift card currency (MDL) does not match the order currency'),
        ru.errGiftCardCurrency,
      );
      expect(giftCardErrorText(ru, 'Gift card has expired'), ru.errGiftCardExpired);
      expect(giftCardErrorText(ru, 'Gift card is expired'), ru.errGiftCardExpired);
      expect(giftCardErrorText(ru, 'Gift card is redeemed'), ru.errGiftCardUsedUp);
      expect(giftCardErrorText(ru, 'Gift card has no remaining balance'), ru.errGiftCardUsedUp);
      expect(giftCardErrorText(ru, 'Gift card is cancelled'), ru.errGiftCardCancelled);
      expect(giftCardErrorText(en, 'Gift card not found'), 'There is no such gift card');
      expect(giftCardErrorText(ru, 'Store is closed'), isNull);
      expect(giftCardErrorText(ru, null), isNull);
    });
  });
}
