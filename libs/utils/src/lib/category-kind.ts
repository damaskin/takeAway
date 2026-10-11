import type { CategoryKind } from '@takeaway/shared-types';

/**
 * Word beginnings that give a category's kind away, lower case, checked in
 * this order — the first kind with a match wins:
 *
 * - FOOD first: «Горячие блюда» and «Холодные закуски» are food, not drinks;
 * - cold drinks before hot ones: «Айс латте», «Холодный кофе»;
 * - bakery last: «Кофе и десерты» is a coffee category.
 *
 * Each entry is a regular-expression fragment matched at the start of a
 * word (after the start of the name or any character that is not a Latin
 * or Cyrillic letter), so «чай» finds «Чайные напитки» but not «случайный».
 * The migration `20261011120000_category_kind_option_presets` runs the same
 * patterns in SQL (see {@link categoryKindPattern}); a test there compares.
 */
export const CATEGORY_KIND_STEMS: ReadonlyArray<readonly [Exclude<CategoryKind, 'OTHER'>, readonly string[]]> = [
  [
    'FOOD',
    [
      'шаурм',
      'шаверм',
      'бургер',
      'сэндвич',
      'сендвич',
      'хот-?дог',
      'хот дог',
      'завтрак',
      'салат',
      'суп',
      'пицц',
      'ролл',
      'фаст-?фуд',
      'стрит-?фуд',
      'блюд',
      'еда',
      'закуск',
      'ланч',
      'обед',
      'боул',
      'тортиль',
      'food',
      'burger',
      'sandwich',
      'hot-?dog',
      'hot dog',
      'breakfast',
      'salad',
      'soup',
      'pizza',
      'lunch',
      'meal',
      'dish',
      'snack',
    ],
  ],
  [
    'COLD_DRINKS',
    [
      'холодн',
      'айс',
      'со льдом',
      'лимонад',
      'смузи',
      'коктейл',
      'милкшейк',
      'фрапп',
      'вода',
      'воды',
      'сок',
      'газир',
      'морс',
      'ice',
      'cold',
      'lemonade',
      'smoothie',
      'juice',
      'milkshake',
      'frapp',
      'soda',
      'water',
    ],
  ],
  [
    'HOT_DRINKS',
    [
      'кофе',
      'капучино',
      'латте',
      'американо',
      'эспрессо',
      'раф',
      'флэт',
      'флет',
      'чай',
      'какао',
      'матча',
      'горяч',
      'coffee',
      'cappuccino',
      'latte',
      'americano',
      'espresso',
      'tea',
      'cocoa',
      'matcha',
      'hot',
    ],
  ],
  [
    'BAKERY',
    [
      'выпечк',
      'десерт',
      'пряник',
      'круассан',
      'торт',
      'пирож',
      'пирог',
      'печень',
      'маффин',
      'кекс',
      'чизкейк',
      'булоч',
      'вафл',
      'пончик',
      'донат',
      'эклер',
      'bakery',
      'dessert',
      'pastr',
      'cake',
      'croissant',
      'cookie',
      'muffin',
      'donut',
      'waffle',
    ],
  ],
];

/**
 * The regular expression for one kind's stems, as a string both JavaScript
 * and PostgreSQL read the same way. It expects a lower-cased name.
 */
export function categoryKindPattern(stems: readonly string[]): string {
  return `(^|[^a-zа-яё])(${stems.join('|')})`;
}

const MATCHERS: ReadonlyArray<readonly [CategoryKind, RegExp]> = CATEGORY_KIND_STEMS.map(
  ([kind, stems]) => [kind, new RegExp(categoryKindPattern(stems))] as const,
);

/**
 * The kind a category of this name most likely is — the admin's suggestion
 * for a new category, and what the migration filled in for existing ones.
 * OTHER when nothing gives it away; the owner can always change it.
 */
export function inferCategoryKind(name: string | null | undefined): CategoryKind {
  const text = (name ?? '').toLowerCase();
  if (!text.trim()) return 'OTHER';
  return MATCHERS.find(([, re]) => re.test(text))?.[0] ?? 'OTHER';
}

const PLACEHOLDER_FILES: Readonly<Record<CategoryKind, string>> = {
  HOT_DRINKS: 'hot-drink.svg',
  COLD_DRINKS: 'cold-drink.svg',
  FOOD: 'food.svg',
  BAKERY: 'bakery.svg',
  OTHER: 'other.svg',
};

/**
 * The picture a product without a photo shows, by its category's kind —
 * one of libs/ui-kit/src/assets/product-placeholders, which the Angular
 * apps serve under `/ui-kit/product-placeholders/`. A missing or unknown
 * kind (an older API) gets the neutral one.
 */
export function productPlaceholderUrl(kind: string | null | undefined, base = '/ui-kit/product-placeholders/'): string {
  const known = (Object.keys(PLACEHOLDER_FILES) as CategoryKind[]).find((k) => k === kind);
  return `${base}${PLACEHOLDER_FILES[known ?? 'OTHER']}`;
}
