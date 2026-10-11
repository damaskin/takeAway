export const PRODUCT_KINDS = ['DRINK', 'FOOD'] as const;
export type ProductKind = (typeof PRODUCT_KINDS)[number];

/** What the menu says about a product that hints at a drink or a dish. */
export interface ProductKindSignals {
  /** The product's name as it was sold. */
  name: string;
  /** The category it sits in now; null once the product is gone from the menu. */
  categoryName: string | null;
  /** Set only on drinks in the menu editor. */
  caffeineLevel: number | null;
  /** Has a temperature, milk or cup option — drink options, unlike size. */
  drinkOptions: boolean;
}

// Word stems, lower case: a category is "Кофе", "Напитки", "Чай и какао",
// "Десерты", "Выпечка", "Сэндвичи"… in Russian, Romanian or English.
const DRINK_WORDS = [
  'кофе',
  'напит',
  'чай',
  'какао',
  'латте',
  'капучино',
  'американо',
  'эспрессо',
  'флэт',
  'лимонад',
  'смузи',
  'сок',
  'фреш',
  'коктейл',
  'шейк',
  'матча',
  'cafea',
  'bautur',
  'băutur',
  'ceai',
  'coffee',
  'drink',
  'beverage',
  'tea',
  'latte',
  'cappuccino',
  'espresso',
  'americano',
  'cocoa',
  'lemonade',
  'smoothie',
  'juice',
  'shake',
  'matcha',
];

const FOOD_WORDS = [
  'еда',
  'блюд',
  'выпеч',
  'десерт',
  'торт',
  'пирож',
  'пирог',
  'круассан',
  'сэндвич',
  'сендвич',
  'бутерброд',
  'салат',
  'суп',
  'завтрак',
  'обед',
  'закуск',
  'снек',
  'пицц',
  'бургер',
  'ролл',
  'печень',
  'кекс',
  'маффин',
  'чизкейк',
  'вафл',
  'блин',
  'сырник',
  'омлет',
  'боул',
  'mâncare',
  'mancare',
  'desert',
  'patiser',
  'food',
  'meal',
  'dish',
  'bakery',
  'pastry',
  'dessert',
  'cake',
  'croissant',
  'sandwich',
  'salad',
  'soup',
  'breakfast',
  'lunch',
  'snack',
  'pizza',
  'burger',
  'cookie',
  'muffin',
  'bowl',
];

/** A word of the text starts with one of the stems — "Напитки", but not "steak" for "tea". */
function mentions(text: string | null, stems: readonly string[]): boolean {
  if (!text) return false;
  const words = text.toLowerCase().split(/[^\p{L}]+/u);
  return words.some((word) => word.length > 0 && stems.some((stem) => word.startsWith(stem)));
}

/**
 * Drink or food, for splitting a customer's favourites. The menu has no
 * such flag, so it reads the signals it does have: caffeine and drink
 * options are only ever set on drinks; then the category name; then the
 * product's own name. Null when nothing points either way — the admin
 * shows those under a plain «Любимое».
 */
export function productKind(signals: ProductKindSignals): ProductKind | null {
  if (signals.caffeineLevel !== null || signals.drinkOptions) return 'DRINK';
  if (mentions(signals.categoryName, DRINK_WORDS)) return 'DRINK';
  if (mentions(signals.categoryName, FOOD_WORDS)) return 'FOOD';
  if (mentions(signals.name, DRINK_WORDS)) return 'DRINK';
  if (mentions(signals.name, FOOD_WORDS)) return 'FOOD';
  return null;
}
