import 'dart:convert';

import 'package:takeaway_api/takeaway_api.dart';
import 'package:test/test.dart';

// A port of `libs/utils/src/lib/option-groups.spec.ts`, case for case, with
// the same data and the same expected results: the app prices and checks a
// choice with the rules the API applies.

ProductOptionItem option(
  String id, {
  String? name,
  String? note,
  bool isDefault = false,
  int? minQty,
  int? maxQty,
  int? defaultQty,
  int priceCents = 0,
  bool available = true,
}) => ProductOptionItem(
  id: id,
  name: name ?? id,
  note: note,
  isDefault: isDefault,
  minQty: minQty,
  maxQty: maxQty,
  defaultQty: defaultQty,
  priceCents: priceCents,
  available: available,
);

ProductOptionGroup optionGroup(
  String id, {
  required List<ProductOptionItem> options,
  String? name,
  OptionGroupKind kind = OptionGroupKind.addon,
  OptionGroupType type = OptionGroupType.a,
  int? minSelect,
  int? maxSelect,
  String? showIfOptionId,
}) => ProductOptionGroup(
  id: id,
  kind: kind,
  type: type,
  name: name ?? id,
  minSelect: minSelect,
  maxSelect: maxSelect,
  showIfOptionId: showIfOptionId,
  options: options,
);

/// [g] with other options, everything else as it was.
ProductOptionGroup withOptions(ProductOptionGroup g, List<ProductOptionItem> options) => ProductOptionGroup(
  id: g.id,
  kind: g.kind,
  type: g.type,
  name: g.name,
  minSelect: g.minSelect,
  maxSelect: g.maxSelect,
  showIfOptionId: g.showIfOptionId,
  options: options,
);

ProductOptionItem withAvailable(ProductOptionItem o, bool available) => ProductOptionItem(
  id: o.id,
  name: o.name,
  note: o.note,
  isDefault: o.isDefault,
  minQty: o.minQty,
  maxQty: o.maxQty,
  defaultQty: o.defaultQty,
  priceCents: o.priceCents,
  available: available,
);

// The cappuccino of the spec's example (§6), priced per the spec: M is the
// base (4500), oat +1000, syrups +800 each, sugar free.
final size = optionGroup(
  'size',
  name: 'Размер (кофе)',
  kind: OptionGroupKind.variant,
  minSelect: 1,
  maxSelect: 1,
  options: [
    option('S', name: 'S', note: '150–250 мл', priceCents: -500),
    option('M', name: 'M', note: '300–350 мл'),
    option('L', name: 'L', note: '400–450 мл', priceCents: 700),
  ],
);
final serving = optionGroup(
  'serving',
  name: 'Подача',
  kind: OptionGroupKind.variant,
  minSelect: 1,
  maxSelect: 1,
  options: [
    option('hot', name: 'Горячий', isDefault: true),
    option('iced', name: 'Холодный'),
  ],
);
final milk = optionGroup(
  'milk',
  name: 'Молоко',
  minSelect: 1,
  maxSelect: 1,
  options: [
    option('cow', name: 'Коровье', isDefault: true),
    option('oat', name: 'Овсяное', priceCents: 1000),
    option('coconut', name: 'Кокосовое', priceCents: 1000, available: false),
  ],
);
final syrups = optionGroup(
  'syrups',
  name: 'Сиропы',
  minSelect: 0,
  maxSelect: 2,
  options: [
    option('vanilla', name: 'Ваниль', priceCents: 800),
    option('salted', name: 'Солёная карамель', priceCents: 800),
    option('hazelnut', name: 'Лесной орех', priceCents: 800),
  ],
);
final foam = optionGroup(
  'foam',
  name: 'Пенка-топ',
  minSelect: 0,
  maxSelect: 1,
  showIfOptionId: 'iced',
  options: [option('cream-foam', name: 'Сливочная', priceCents: 900)],
);
final extras = optionGroup(
  'extras',
  name: 'Добавки к кофе',
  type: OptionGroupType.b,
  options: [
    option('cinnamon', name: 'Корица', priceCents: 200),
    option('honey', name: 'Мёд', priceCents: 300),
  ],
);
final sugar = optionGroup(
  'sugar',
  name: 'Сахар',
  type: OptionGroupType.c,
  options: [option('sugar1', name: 'Сахар', minQty: 0, maxQty: 3, defaultQty: 0)],
);
final ice = optionGroup(
  'ice',
  name: 'Лёд',
  type: OptionGroupType.c,
  showIfOptionId: 'iced',
  options: [option('ice1', name: 'Лёд', minQty: 0, maxQty: 3, defaultQty: 0, priceCents: 100)],
);
final coffee = [size, serving, milk, syrups, foam, extras, sugar, ice];

final meatKind = optionGroup(
  'meat-kind',
  name: 'Мясо',
  kind: OptionGroupKind.variant,
  minSelect: 1,
  maxSelect: 1,
  options: [
    option('chicken', name: 'Курица', isDefault: true),
    option('beef', name: 'Говядина', priceCents: 1500),
  ],
);
final meatPortions = optionGroup(
  'meat',
  name: 'Мясо (порции)',
  type: OptionGroupType.c,
  options: [option('meat1', name: 'Мясо / котлета', minQty: 1, maxQty: 2, defaultQty: 1, priceCents: 2500)],
);
final shawarma = [meatKind, meatPortions];

OptionPickError err(OptionPickErrorCode code, String? groupId, String? optionId) =>
    OptionPickError(code, groupId: groupId, optionId: optionId);

/// The fields of [line] the spec's `objectContaining` checks look at.
Map<String, Object?> lineFields(OptionLine line) => {
  'optionId': line.optionId,
  'kind': line.kind,
  'groupName': line.groupName,
  'qty': line.qty,
  'freeQty': line.freeQty,
  'totalCents': line.totalCents,
};

void main() {
  group('option groups', () {
    group('defaultOptionPicks', () {
      test('picks the defaults and leaves a variant without one for the customer', () {
        expect(defaultOptionPicks(coffee), {'hot': 1, 'cow': 1});
      });

      test('starts a C option at its default amount', () {
        expect(defaultOptionPicks(shawarma), {'chicken': 1, 'meat1': 1});
      });

      test('skips a default the store has run out of', () {
        final out = withOptions(milk, [for (final o in milk.options) withAvailable(o, o.id != 'cow')]);
        expect(defaultOptionPicks([out]), <String, int>{});
      });
    });

    group('a required variant', () {
      test('keeps the product out of the cart until it is picked', () {
        final picks = defaultOptionPicks(coffee);
        expect(validateOptionPicks(coffee, picks), [err(OptionPickErrorCode.tooFew, 'size', null)]);
        expect(needsOptionChoice(coffee), isTrue);
        expect(validateOptionPicks(coffee, toggleOptionPick(coffee, picks, 'M')), isEmpty);
      });

      test('lets a product whose defaults are a full choice go in with one tap', () {
        expect(needsOptionChoice(shawarma), isFalse);
        expect(needsOptionChoice([]), isFalse);
      });

      test('cannot be unpicked, only moved', () {
        final picks = toggleOptionPick(coffee, defaultOptionPicks(coffee), 'M');
        expect(toggleOptionPick(coffee, picks, 'M'), picks);
        expect(toggleOptionPick(coffee, picks, 'L'), {'hot': 1, 'cow': 1, 'L': 1});
      });
    });

    group('type A with a maximum of 2', () {
      test('does not take a third syrup', () {
        var picks = toggleOptionPick(coffee, {'M': 1, 'hot': 1, 'cow': 1}, 'vanilla');
        picks = toggleOptionPick(coffee, picks, 'salted');
        expect(toggleOptionPick(coffee, picks, 'hazelnut'), picks);
        expect(validateOptionPicks(coffee, {...picks, 'hazelnut': 1}), [
          err(OptionPickErrorCode.tooMany, 'syrups', null),
        ]);
      });

      test('lets a syrup be taken off again', () {
        final picks = toggleOptionPick(coffee, {'M': 1, 'hot': 1, 'cow': 1}, 'vanilla');
        expect(toggleOptionPick(coffee, picks, 'vanilla'), {'M': 1, 'hot': 1, 'cow': 1});
      });
    });

    group('type B', () {
      test('switches every option on and off on its own', () {
        var picks = toggleOptionPick(coffee, {'M': 1, 'hot': 1, 'cow': 1}, 'cinnamon');
        picks = toggleOptionPick(coffee, picks, 'honey');
        expect(picks, {'M': 1, 'hot': 1, 'cow': 1, 'cinnamon': 1, 'honey': 1});
        expect(toggleOptionPick(coffee, picks, 'cinnamon'), {'M': 1, 'hot': 1, 'cow': 1, 'honey': 1});
      });

      test('takes no more than one of an option', () {
        expect(validateOptionPicks(coffee, {'M': 1, 'hot': 1, 'cow': 1, 'honey': 2}), [
          err(OptionPickErrorCode.badQty, 'extras', 'honey'),
        ]);
      });
    });

    group('type C', () {
      test('keeps the counter within its bounds, and 0 leaves the option out', () {
        const base = {'M': 1, 'hot': 1, 'cow': 1};
        expect(setOptionQty(coffee, base, 'sugar1', 5), {...base, 'sugar1': 3});
        expect(setOptionQty(coffee, base, 'sugar1', -1), base);
        expect(
          optionLinesFor(coffee, setOptionQty(coffee, {...base, 'sugar1': 2}, 'sugar1', 0)).map((l) => l.optionId),
          isNot(contains('sugar1')),
        );
        expect(validateOptionPicks(coffee, {...base, 'sugar1': 4}), [
          err(OptionPickErrorCode.tooMany, 'sugar', 'sugar1'),
        ]);
      });

      test('meat: not below 1, the first portion is in the price, the second costs one portion', () {
        final picks = defaultOptionPicks(shawarma);
        expect(setOptionQty(shawarma, picks, 'meat1', 0), picks);
        expect(priceWithOptionPicks(15000, shawarma, picks), 15000);
        expect(priceWithOptionPicks(15000, shawarma, setOptionQty(shawarma, picks, 'meat1', 2)), 17500);
        expect(validateOptionPicks(shawarma, {'chicken': 1}), [err(OptionPickErrorCode.tooFew, 'meat', 'meat1')]);
      });

      test('charges every unit of an option the dish does not include', () {
        const picks = {'M': 1, 'iced': 1, 'cow': 1, 'ice1': 3};
        expect(priceWithOptionPicks(4500, coffee, picks), 4800);
      });
    });

    group('conditions (show_if)', () {
      test('shows ice and foam only for an iced coffee', () {
        const hot = {'M': 1, 'hot': 1, 'cow': 1};
        expect(isGroupVisible(ice, coffee, hot), isFalse);
        expect(isGroupVisible(foam, coffee, hot), isFalse);
        final iced = toggleOptionPick(coffee, hot, 'iced');
        expect(isGroupVisible(ice, coffee, iced), isTrue);
        expect(isGroupVisible(foam, coffee, iced), isTrue);
      });

      test('drops their picks when the coffee goes back to hot', () {
        var picks = toggleOptionPick(coffee, {'M': 1, 'hot': 1, 'cow': 1}, 'iced');
        picks = setOptionQty(coffee, picks, 'ice1', 2);
        picks = toggleOptionPick(coffee, picks, 'cream-foam');
        expect(toggleOptionPick(coffee, picks, 'hot'), {'M': 1, 'hot': 1, 'cow': 1});
      });

      test('refuses a pick in a hidden group', () {
        expect(validateOptionPicks(coffee, {'M': 1, 'hot': 1, 'cow': 1, 'ice1': 1}), [
          err(OptionPickErrorCode.hiddenGroup, 'ice', 'ice1'),
        ]);
      });

      test('always shows the group when the condition is not on the product (ice for a cola)', () {
        final drinkSize = optionGroup(
          'drink',
          kind: OptionGroupKind.variant,
          maxSelect: 1,
          options: [option('03', isDefault: true)],
        );
        final cola = [drinkSize, ice];
        expect(isGroupVisible(ice, cola, {}), isTrue);
        expect(validateOptionPicks(cola, {'03': 1, 'ice1': 2}), isEmpty);
      });

      test('shows nothing for a loop of conditions', () {
        final a = optionGroup('a', showIfOptionId: 'b1', options: [option('a1')]);
        final b = optionGroup('b', showIfOptionId: 'a1', options: [option('b1')]);
        expect(isGroupVisible(a, [a, b], {'a1': 1, 'b1': 1}), isFalse);
      });

      test('settles a chain of conditions in one go', () {
        final a = optionGroup('a', type: OptionGroupType.b, options: [option('a1')]);
        final b = optionGroup('b', type: OptionGroupType.b, showIfOptionId: 'a1', options: [option('b1')]);
        final c = optionGroup('c', type: OptionGroupType.b, showIfOptionId: 'b1', options: [option('c1')]);
        expect(normalizeOptionPicks([a, b, c], {'b1': 1, 'c1': 1}), <String, int>{});
      });
    });

    group('stop list', () {
      test('cannot pick an option the store has run out of', () {
        const picks = {'M': 1, 'hot': 1, 'cow': 1};
        expect(toggleOptionPick(coffee, picks, 'coconut'), picks);
        expect(validateOptionPicks(coffee, {'M': 1, 'hot': 1, 'coconut': 1}), [
          err(OptionPickErrorCode.optionUnavailable, 'milk', 'coconut'),
        ]);
      });

      test('cannot make a dish whose required portion has run out', () {
        final portion = option('meat1', name: 'Мясо / котлета', minQty: 1, maxQty: 2, defaultQty: 1, available: false);
        final out = [
          meatKind,
          withOptions(meatPortions, [portion]),
        ];
        expect(defaultOptionPicks(out), {'chicken': 1});
        expect(validateOptionPicks(out, {'chicken': 1}), [err(OptionPickErrorCode.optionUnavailable, 'meat', 'meat1')]);
      });

      test('does not know an option the product does not offer', () {
        expect(validateOptionPicks(coffee, {'M': 1, 'hot': 1, 'cow': 1, 'nope': 1}), [
          err(OptionPickErrorCode.unknownOption, null, 'nope'),
        ]);
        expect(validateOptionPicks(coffee, {'M': 1.5}), [err(OptionPickErrorCode.badQty, 'size', 'M')]);
      });
    });

    group('price and lines', () {
      const example = {'M': 1, 'hot': 1, 'oat': 1, 'vanilla': 1, 'salted': 1, 'sugar1': 2};

      test('prices the spec example at 71', () {
        expect(validateOptionPicks(coffee, example), isEmpty);
        expect(priceWithOptionPicks(4500, coffee, example), 7100);
      });

      test('takes a variant price off or onto the base price', () {
        expect(priceWithOptionPicks(4500, coffee, {'S': 1, 'hot': 1, 'cow': 1}), 4000);
        expect(priceWithOptionPicks(4500, coffee, {'L': 1, 'hot': 1, 'cow': 1}), 5200);
      });

      test('lists the picks variants first, in page order, with prices', () {
        final lines = optionLinesFor(coffee, example).map(lineFields).toList();
        expect(lines, hasLength(6));
        expect(lines[0], containsPair('optionId', 'M'));
        expect(lines[0], allOf(containsPair('kind', OptionGroupKind.variant), containsPair('totalCents', 0)));
        expect(lines[1], allOf(containsPair('optionId', 'hot'), containsPair('kind', OptionGroupKind.variant)));
        expect(lines[1], containsPair('totalCents', 0));
        expect(lines[2], allOf(containsPair('optionId', 'oat'), containsPair('groupName', 'Молоко')));
        expect(lines[2], containsPair('totalCents', 1000));
        expect(lines[3], allOf(containsPair('optionId', 'vanilla'), containsPair('totalCents', 800)));
        expect(lines[4], allOf(containsPair('optionId', 'salted'), containsPair('totalCents', 800)));
        expect(lines[5], allOf(containsPair('optionId', 'sugar1'), containsPair('qty', 2)));
        expect(lines[5], allOf(containsPair('freeQty', 0), containsPair('totalCents', 0)));
      });

      test('describes the line as the kitchen reads it', () {
        expect(
          describeOptionLines(optionLinesFor(coffee, example)),
          'M, Горячий · Овсяное · Ваниль + Солёная карамель · Сахар ×2',
        );
      });

      test('does not mention the meat portion the dish includes, only a double one', () {
        expect(describeOptionLines(optionLinesFor(shawarma, {'beef': 1, 'meat1': 1})), 'Говядина');
        expect(describeOptionLines(optionLinesFor(shawarma, {'beef': 1, 'meat1': 2})), 'Говядина · Мясо / котлета ×2');
      });

      test('puts variants before add-ons whatever order the groups come in', () {
        expect(orderOptionGroups([milk, size, sugar, serving]).map((g) => g.id), ['size', 'serving', 'milk', 'sugar']);
      });
    });

    group('selections', () {
      test('round-trips the API form in a stable order', () {
        expect(toOptionSelections({'oat': 1, 'M': 1, 'sugar1': 0}), const [
          OptionSelection(optionId: 'M', qty: 1),
          OptionSelection(optionId: 'oat', qty: 1),
        ]);
        expect(
          fromOptionSelections(const [
            OptionSelection(optionId: 'ice1', qty: 1),
            OptionSelection(optionId: 'ice1', qty: 1),
          ]),
          {'ice1': 2},
        );
      });

      test('gives the same choice the same cart key in any order, and a different one another', () {
        final a = optionSelectionKey(const [
          OptionSelection(optionId: 'oat', qty: 1),
          OptionSelection(optionId: 'M', qty: 1),
        ]);
        final b = optionSelectionKey(const [
          OptionSelection(optionId: 'M', qty: 1),
          OptionSelection(optionId: 'oat', qty: 1),
        ]);
        final c = optionSelectionKey(const [
          OptionSelection(optionId: 'M', qty: 1),
          OptionSelection(optionId: 'cow', qty: 1),
        ]);
        expect(a, b);
        expect(a, isNot(c));
      });
    });

    group('order snapshots', () {
      const example = {'M': 1, 'hot': 1, 'oat': 1};

      test('reads option lines back and describes them with the older options', () {
        // Through JSON, as the order arrives from the API.
        final snapshot =
            jsonDecode(
                  jsonEncode({
                    'id': 'p',
                    'name': 'Капучино',
                    'optionLines': [
                      ...optionLinesFor(coffee, example).map((l) => l.toJson()),
                      {'name': 'broken'},
                    ],
                  }),
                )
                as Map<String, dynamic>;
        final item = OrderItem.fromJson({
          'id': 'oi',
          'productSnapshot': snapshot,
          'quantity': 1,
          'unitPriceCents': 5500,
          'totalCents': 5500,
        });
        expect(item.optionLines, hasLength(3));
        expect(describeOrderItemOptions(snapshot), 'M, Горячий · Овсяное');
      });

      test('reads an order placed before the catalog with no option lines', () {
        final item = OrderItem.fromJson({
          'id': 'oi',
          'productSnapshot': {'id': 'p', 'name': 'Латте'},
          'quantity': 1,
          'unitPriceCents': 3000,
          'totalCents': 3000,
        });
        expect(item.optionLines, isEmpty);
        expect(
          describeOrderItemOptions({
            'variations': [
              {'id': 'v', 'type': 'SIZE', 'name': 'L', 'priceDeltaCents': 0},
            ],
            'modifierLines': <Object>[],
          }),
          'L',
        );
      });
    });
  });

  // Beyond the TypeScript spec: what the product screen leans on.
  group('the product screen', () {
    test('reads the bounds of each group', () {
      expect(selectBounds(size), (min: 1, max: 1));
      expect(selectBounds(syrups), (min: 0, max: 2));
      expect(selectBounds(optionGroup('x', kind: OptionGroupKind.variant, options: [option('a'), option('b')])), (
        min: 1,
        max: 2,
      ));
      expect(qtyBounds(meatPortions.options.single), (min: 1, max: 2));
      expect(qtyBounds(option('q')), (min: 0, max: optionMaxQtyLimit));
      expect(freeQty(meatPortions, meatPortions.options.single), 1);
      expect(freeQty(milk, milk.options.first), 0);
    });

    test('describes the older options of an order line in the order a barista reads them', () {
      expect(
        describeOrderItemOptions({
          'variations': [
            {'id': 'v1', 'type': 'TEMPERATURE', 'name': 'Iced'},
            {'id': 'v2', 'type': 'SIZE', 'name': 'L'},
            {'id': 'v3', 'type': 'MILK', 'name': 'Oat'},
            {'id': 'v4', 'type': 'NEW', 'name': 'Skipped'},
          ],
          'modifierLines': [
            {'id': 'm1', 'name': 'Vanilla syrup', 'count': 2, 'priceCents': 500},
            {'id': 'm2', 'name': 'Shot', 'count': 1},
            {'id': 'm3', 'name': 'None', 'count': 0},
          ],
        }),
        'L · Oat · Iced · +Vanilla syrup ×2 · +Shot',
      );
      expect(describeOrderItemOptions({}), '');
    });
  });
}
