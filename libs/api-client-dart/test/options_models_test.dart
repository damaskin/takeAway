import 'dart:convert';

import 'package:takeaway_api/takeaway_api.dart';
import 'package:test/test.dart';

// The options catalog's JSON, built from `libs/shared-types` (the API sends
// it from 2026-11-09): product groups, cart lines, requests, order lines and
// the 400 the cart answers with.

Map<String, dynamic> _product({Map<String, dynamic> extra = const {}}) => {
  'id': 'p_capp',
  'categoryId': 'cat',
  'brandId': 'br',
  'slug': 'cappuccino',
  'name': 'Капучино',
  'basePriceCents': 4500,
  'prepTimeSeconds': 180,
  'imageUrls': <String>[],
  'sortOrder': 0,
  'variations': <Object>[],
  'modifiers': <Object>[],
  ...extra,
};

Map<String, dynamic> _item(String id, String name, {Map<String, dynamic> extra = const {}}) => {
  'id': id,
  'name': name,
  'note': null,
  'isDefault': false,
  'minQty': null,
  'maxQty': null,
  'defaultQty': null,
  'priceCents': 0,
  'available': true,
  'sortOrder': 0,
  ...extra,
};

Map<String, dynamic> _line(String optionId, String name, {String kind = 'ADDON', String type = 'A', int qty = 1}) => {
  'groupId': 'g_$optionId',
  'groupName': 'Группа',
  'kind': kind,
  'type': type,
  'optionId': optionId,
  'name': name,
  'qty': qty,
  'unitPriceCents': 800,
  'freeQty': 0,
  'totalCents': 800,
};

void main() {
  group('catalog', () {
    test('reads the option groups of a product, variants with notes and prices', () {
      final product = ProductDetail.fromJson(
        _product(
          extra: {
            'hasRequiredOptions': true,
            'optionGroups': [
              {
                'id': 'g_size',
                'kind': 'VARIANT',
                'type': 'A',
                'name': 'Размер (кофе)',
                'minSelect': 1,
                'maxSelect': 1,
                'showIfOptionId': null,
                'options': [
                  _item('o_s', 'S', extra: {'note': '150–250 мл', 'priceCents': -500}),
                  _item('o_m', 'M', extra: {'note': '  ', 'isDefault': true, 'sortOrder': 1}),
                ],
              },
              {
                'id': 'g_ice',
                'kind': 'ADDON',
                'type': 'C',
                'name': 'Лёд',
                'minSelect': null,
                'maxSelect': null,
                'showIfOptionId': 'o_iced',
                'options': [
                  _item('o_ice', 'Лёд', extra: {'minQty': 0, 'maxQty': 3, 'defaultQty': 0, 'available': false}),
                ],
              },
            ],
          },
        ),
      );

      expect(product.hasRequiredOptions, isTrue);
      expect(product.hasOptionGroups, isTrue);
      final [sizes, iceGroup] = product.optionGroups;
      expect(sizes.kind, OptionGroupKind.variant);
      expect(sizes.isVariant, isTrue);
      expect(sizes.type, OptionGroupType.a);
      expect((sizes.minSelect, sizes.maxSelect, sizes.showIfOptionId), (1, 1, null));
      expect(sizes.options.map((o) => (o.name, o.note, o.priceCents, o.isDefault)), [
        ('S', '150–250 мл', -500, false),
        ('M', null, 0, true),
      ]);
      expect(iceGroup.type, OptionGroupType.c);
      expect(iceGroup.showIfOptionId, 'o_iced');
      final ice = iceGroup.options.single;
      expect((ice.minQty, ice.maxQty, ice.defaultQty, ice.available), (0, 3, 0, false));
    });

    test('reads a product without groups from an API that predates the catalog', () {
      final product = ProductDetail.fromJson(_product());
      expect(product.optionGroups, isEmpty);
      expect(product.hasOptionGroups, isFalse);
      expect(product.hasRequiredOptions, isFalse);
      expect(Product.fromJson(_product()).hasRequiredOptions, isFalse);
      expect(Product.fromJson(_product(extra: {'hasRequiredOptions': true})).hasRequiredOptions, isTrue);
    });

    test('leaves out the groups and options it cannot show instead of failing the product', () {
      final product = ProductDetail.fromJson(
        _product(
          extra: {
            'optionGroups': [
              'junk',
              {
                'id': 'g_d',
                'kind': 'ADDON',
                'type': 'D',
                'name': 'Reserved',
                'options': [_item('o1', 'One')],
              },
              {
                'id': 'g_new',
                'kind': 'COMBO',
                'type': 'A',
                'name': 'New kind',
                'options': [_item('o2', 'Two')],
              },
              {'id': 'g_empty', 'kind': 'ADDON', 'type': 'B', 'name': 'Empty', 'options': <Object>[]},
              {'id': 'g_noname', 'kind': 'ADDON', 'type': 'B', 'options': <Object>[]},
              {
                'id': 'g_ok',
                'kind': 'ADDON',
                'type': 'B',
                'name': 'Убрать',
                'options': [
                  {'id': 'broken'},
                  _item('o_onion', 'Без лука'),
                ],
              },
            ],
          },
        ),
      );
      expect(product.optionGroups.map((g) => g.id), ['g_ok']);
      expect(product.optionGroups.single.options.map((o) => o.id), ['o_onion']);
    });

    test('round-trips the groups and the flag through toJson for the offline cache', () {
      final product = ProductDetail.fromJson(
        _product(
          extra: {
            'hasRequiredOptions': true,
            'optionGroups': [
              {
                'id': 'g_milk',
                'kind': 'ADDON',
                'type': 'A',
                'name': 'Молоко',
                'minSelect': 1,
                'maxSelect': 1,
                'options': [
                  _item('o_cow', 'Коровье', extra: {'isDefault': true}),
                ],
              },
            ],
          },
        ),
      );
      final cached = ProductDetail.fromJson(jsonDecode(jsonEncode(product.toJson())) as Map<String, dynamic>);
      expect(cached.hasRequiredOptions, isTrue);
      expect(cached.optionGroups.single.name, 'Молоко');
      expect(cached.optionGroups.single.kind, OptionGroupKind.addon);
      expect(cached.optionGroups.single.options.single.isDefault, isTrue);
    });
  });

  group('cart', () {
    test('reads the option lines of a cart line, none from an older API, the broken ones left out', () {
      final base = {
        'id': 'ci',
        'productId': 'p',
        'productName': 'Капучино',
        'quantity': 1,
        'variationIds': <String>[],
        'modifiers': <String, int>{},
        'unitPriceCents': 7100,
        'unitPrepSeconds': 180,
      };
      expect(CartItem.fromJson(base).options, isEmpty);
      final item = CartItem.fromJson({
        ...base,
        'options': [
          _line('o_m', 'M', kind: 'VARIANT'),
          _line('o_sugar', 'Сахар', type: 'C', qty: 2),
          {'optionId': 'x', 'name': 'No kind', 'qty': 1},
          {'optionId': 'y', 'name': 'Zero', 'qty': 0, 'kind': 'ADDON', 'type': 'A'},
          'junk',
        ],
      });
      expect(item.options.map((l) => (l.optionId, l.kind, l.type, l.qty)), [
        ('o_m', OptionGroupKind.variant, OptionGroupType.a, 1),
        ('o_sugar', OptionGroupKind.addon, OptionGroupType.c, 2),
      ]);
      expect(item.options.last.selection, const OptionSelection(optionId: 'o_sugar', qty: 2));
    });

    test('sends the picks with an add, and leaves them out when there are none', () {
      final withOptions = const AddCartItemRequest(
        storeId: 's',
        productId: 'p',
        quantity: 1,
        options: [
          OptionSelection(optionId: 'o_m', qty: 1),
          OptionSelection(optionId: 'o_sugar', qty: 2),
        ],
      ).toJson();
      expect(jsonDecode(jsonEncode(withOptions)), {
        'storeId': 's',
        'productId': 'p',
        'quantity': 1,
        'options': [
          {'optionId': 'o_m', 'qty': 1},
          {'optionId': 'o_sugar', 'qty': 2},
        ],
      });
      expect(
        const AddCartItemRequest(storeId: 's', productId: 'p', quantity: 1).toJson().containsKey('options'),
        isFalse,
      );
    });

    test('sends only what an update changes', () {
      expect(const UpdateCartItemRequest(quantity: 3).toJson(), {'quantity': 3});
      expect(
        jsonDecode(
          jsonEncode(const UpdateCartItemRequest(options: [OptionSelection(optionId: 'o_l', qty: 1)]).toJson()),
        ),
        {
          'options': [
            {'optionId': 'o_l', 'qty': 1},
          ],
        },
      );
    });
  });

  group('orders', () {
    test('reads the option lines of an order line, none from an order placed before the catalog', () {
      Map<String, dynamic> item(Map<String, dynamic> snapshot) => {
        'id': 'oi',
        'productSnapshot': snapshot,
        'quantity': 1,
        'unitPriceCents': 7100,
        'totalCents': 7100,
      };
      final bought = OrderItem.fromJson(
        item({
          'id': 'p',
          'name': 'Капучино',
          'optionLines': [_line('o_m', 'M', kind: 'VARIANT'), _line('o_oat', 'Овсяное')],
        }),
      );
      expect(bought.optionLines.map((l) => l.name), ['M', 'Овсяное']);
      expect(OrderItem.fromJson(item({'id': 'p', 'name': 'Латте'})).optionLines, isEmpty);
      expect(OrderItem.fromJson(item({'id': 'p', 'name': 'Латте', 'optionLines': 'junk'})).optionLines, isEmpty);
    });

    test('reads the 400 the cart answers for a choice it refuses', () {
      final invalid = OptionsErrorBody.tryParse({
        'statusCode': 400,
        'error': 'Bad Request',
        'code': 'OPTIONS_INVALID',
        'message': 'Option is out of stock',
        'errors': [
          {'code': 'OPTION_UNAVAILABLE', 'groupId': 'g_milk', 'optionId': 'o_oat'},
          {'code': 'SOMETHING_NEW', 'groupId': null, 'optionId': null},
          'junk',
        ],
      });
      expect(invalid, isNotNull);
      expect(invalid!.isRequired, isFalse);
      expect(invalid.firstReason, OptionPickErrorCode.optionUnavailable);
      expect(invalid.errors, [
        const OptionPickError(OptionPickErrorCode.optionUnavailable, groupId: 'g_milk', optionId: 'o_oat'),
        const OptionPickError(OptionPickErrorCode.unknown),
      ]);

      final required = OptionsErrorBody.tryParse({'code': 'OPTIONS_REQUIRED', 'errors': <Object>[]});
      expect(required!.isRequired, isTrue);
      expect(required.firstReason, isNull);
      expect(OptionsErrorBody.tryParse({'code': 'CART_EMPTY'}), isNull);
      expect(OptionsErrorBody.tryParse('junk'), isNull);
    });
  });
}
