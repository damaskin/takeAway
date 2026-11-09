import 'package:takeaway_api/takeaway_api.dart';

import 'fake_api.dart';

// Products on the options catalog, as the API sends them (2026-11-09): the
// cappuccino of the spec's example and a shawarma, priced as in
// `libs/utils/src/lib/option-groups.spec.ts`.

Map<String, dynamic> optionJson(
  String id,
  String name, {
  String? note,
  bool isDefault = false,
  int price = 0,
  bool available = true,
  int? minQty,
  int? maxQty,
  int? defaultQty,
}) => {
  'id': id,
  'name': name,
  'note': note,
  'isDefault': isDefault,
  'minQty': minQty,
  'maxQty': maxQty,
  'defaultQty': defaultQty,
  'priceCents': price,
  'available': available,
  'sortOrder': 0,
};

Map<String, dynamic> groupJson(
  String id,
  String name,
  List<Map<String, dynamic>> options, {
  String kind = 'ADDON',
  String type = 'A',
  int? minSelect,
  int? maxSelect,
  String? showIf,
}) => {
  'id': id,
  'kind': kind,
  'type': type,
  'name': name,
  'minSelect': minSelect,
  'maxSelect': maxSelect,
  'showIfOptionId': showIf,
  'options': options,
};

/// Size with no default (so it has to be picked), serving hot by default,
/// cow's milk by default (coconut has run out), up to two syrups at 8,
/// foam and ice only for an iced coffee, cinnamon as a switch, sugar 0…3.
/// M is the base price, 45 MDL.
final cappuccinoGroups = [
  groupJson(
    'g_size',
    'Размер (кофе)',
    [
      optionJson('o_s', 'S', note: '150–250 мл', price: -500),
      optionJson('o_m', 'M', note: '300–350 мл'),
      optionJson('o_l', 'L', note: '400–450 мл', price: 700),
    ],
    kind: 'VARIANT',
    minSelect: 1,
    maxSelect: 1,
  ),
  groupJson(
    'g_serving',
    'Подача',
    [optionJson('o_hot', 'Горячий', isDefault: true), optionJson('o_iced', 'Холодный')],
    kind: 'VARIANT',
    minSelect: 1,
    maxSelect: 1,
  ),
  groupJson(
    'g_milk',
    'Молоко',
    [
      optionJson('o_cow', 'Коровье', isDefault: true),
      optionJson('o_oat', 'Овсяное', price: 1000),
      optionJson('o_coconut', 'Кокосовое', price: 1000, available: false),
    ],
    minSelect: 1,
    maxSelect: 1,
  ),
  groupJson(
    'g_syrups',
    'Сиропы',
    [
      optionJson('o_vanilla', 'Ваниль', price: 800),
      optionJson('o_salted', 'Солёная карамель', price: 800),
      optionJson('o_hazelnut', 'Лесной орех', price: 800),
    ],
    minSelect: 0,
    maxSelect: 2,
  ),
  groupJson(
    'g_foam',
    'Пенка-топ',
    [optionJson('o_foam', 'Сливочная', price: 900)],
    minSelect: 0,
    maxSelect: 1,
    showIf: 'o_iced',
  ),
  groupJson('g_extras', 'Добавки к кофе', [optionJson('o_cinnamon', 'Корица', price: 200)], type: 'B'),
  groupJson('g_sugar', 'Сахар', [optionJson('o_sugar', 'Сахар', minQty: 0, maxQty: 3, defaultQty: 0)], type: 'C'),
  groupJson(
    'g_ice',
    'Лёд',
    [optionJson('o_ice', 'Лёд', minQty: 0, maxQty: 3, defaultQty: 0, price: 100)],
    type: 'C',
    showIf: 'o_iced',
  ),
];

/// Chicken by default (falafel has run out), one meat portion included and
/// a second at 25, «Без лука» as a switch. 150 MDL.
final shawarmaGroups = [
  groupJson(
    'g_meat_kind',
    'Мясо',
    [
      optionJson('o_chicken', 'Курица', isDefault: true),
      optionJson('o_beef', 'Говядина', price: 1500),
      optionJson('o_falafel', 'Фалафель', available: false),
    ],
    kind: 'VARIANT',
    minSelect: 1,
    maxSelect: 1,
  ),
  groupJson('g_meat', 'Мясо (порции)', [
    optionJson('o_meat', 'Мясо / котлета', minQty: 1, maxQty: 2, defaultQty: 1, price: 2500),
  ], type: 'C'),
  groupJson('g_remove', 'Убрать', [optionJson('o_no_onion', 'Без лука')], type: 'B'),
];

Map<String, dynamic> cappuccinoSummary() => {
  ...FakeApi.productJson('p_capp', 'Капучино', 4500),
  'hasRequiredOptions': true,
};

Map<String, dynamic> shawarmaSummary() => {
  ...FakeApi.productJson('p_shawarma', 'Шаурма', 15000, category: 'cat_food'),
  'hasRequiredOptions': false,
};

ProductDetail cappuccino() => ProductDetail.fromJson({
  ...cappuccinoSummary(),
  'categoryKind': 'HOT_DRINKS',
  'brandId': 'br_1',
  'variations': <Object>[],
  'modifiers': <Object>[],
  'optionGroups': cappuccinoGroups,
});

ProductDetail shawarma() => ProductDetail.fromJson({
  ...shawarmaSummary(),
  'categoryKind': 'FOOD',
  'brandId': 'br_1',
  'variations': <Object>[],
  'modifiers': <Object>[],
  'optionGroups': shawarmaGroups,
});

/// A store menu with both, the cappuccino in «Кофе» and the shawarma in «Еда».
FakeApi catalogApi() {
  final api = FakeApi();
  api.menuCategories = [
    {
      ...FakeApi.categoryJson('cat_coffee', 'Кофе', [cappuccinoSummary()]),
      'kind': 'HOT_DRINKS',
    },
    {
      ...FakeApi.categoryJson('cat_food', 'Еда', [shawarmaSummary()], sortOrder: 1),
      'kind': 'FOOD',
    },
  ];
  api.products['p_capp'] = cappuccino();
  api.products['p_shawarma'] = shawarma();
  return api;
}

/// The spec's example: M, hot, oat, vanilla and salted caramel, two sugars —
/// 71 MDL.
const cappuccinoExample = {'o_m': 1, 'o_hot': 1, 'o_oat': 1, 'o_vanilla': 1, 'o_salted': 1, 'o_sugar': 2};

const cappuccinoExampleText = 'M, Горячий · Овсяное · Ваниль + Солёная карамель · Сахар ×2';
