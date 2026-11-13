import { CATEGORY_KINDS, type CategoryKind, type StoreMenu } from '@takeaway/shared-types';

/** Every category kind — defined in shared-types, re-exported for the clients that read it here. */
export { CATEGORY_KINDS };

const DRINK_KINDS: readonly CategoryKind[] = ['HOT_DRINKS', 'COLD_DRINKS'];
const FOOD_KINDS: readonly CategoryKind[] = ['FOOD', 'BAKERY'];

/**
 * What a product is: its own `categoryKind` when the API sends one, else the
 * kind of the menu category it sits in, else OTHER. An API that predates the
 * field, or a kind this build does not know, reads as OTHER — the neutral
 * placeholder and the plain wording, never a guess.
 */
export function productKind(
  product: { categoryKind?: string | null },
  category?: { kind?: string | null } | null,
): CategoryKind {
  return knownKind(product.categoryKind) ?? knownKind(category?.kind) ?? 'OTHER';
}

/** A hot or cold drink: the comment goes to the barista, caffeine is worth showing. */
export function isDrinkKind(kind: CategoryKind): boolean {
  return DRINK_KINDS.includes(kind);
}

/** Something to eat: no caffeine to speak of, and what the upsell offers next to a drink. */
export function isFoodKind(kind: CategoryKind): boolean {
  return FOOD_KINDS.includes(kind);
}

/**
 * Whether a product of this kind shows calories and nutrition (protein,
 * fat, carbs): only meals — the FOOD kind — since 2026-11-06. Drinks,
 * bakery and OTHER have none; the API sends null for them and the admin
 * does not ask for them.
 */
export function showsNutrition(kind: CategoryKind): boolean {
  return kind === 'FOOD';
}

/** One macro on a meal's card: the translation key's last part and the grams to show. */
export interface NutritionMacro {
  key: 'proteins' | 'fats' | 'carbs';
  grams: string;
}

/** What a meal's card says about energy and macros — only the values the brand filled. */
export interface NutritionFacts {
  calories: number | null;
  macros: NutritionMacro[];
}

/**
 * The nutrition a product's card shows: nothing for a drink, a pastry or
 * OTHER (see {@link showsNutrition}); for a meal, the calories and each of
 * protein / fat / carbs the brand filled, in that order. Grams read like the
 * mobile app: whole numbers without a fraction, otherwise one decimal.
 * Returns null when there is nothing to show.
 */
export function nutritionFacts(
  product: {
    calories?: number | null;
    proteinsGrams?: number | null;
    fatsGrams?: number | null;
    carbsGrams?: number | null;
  },
  kind: CategoryKind,
): NutritionFacts | null {
  if (!showsNutrition(kind)) return null;
  const calories = isFiniteNumber(product.calories) ? product.calories : null;
  const macros: NutritionMacro[] = [];
  const add = (key: NutritionMacro['key'], value: number | null | undefined) => {
    if (isFiniteNumber(value)) macros.push({ key, grams: formatGrams(value) });
  };
  add('proteins', product.proteinsGrams);
  add('fats', product.fatsGrams);
  add('carbs', product.carbsGrams);
  return calories === null && macros.length === 0 ? null : { calories, macros };
}

function isFiniteNumber(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function formatGrams(value: number): string {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** Each product of a menu with its kind, by product id. */
export function menuProductKinds(menu: Pick<StoreMenu, 'categories'>): Map<string, CategoryKind> {
  const kinds = new Map<string, CategoryKind>();
  for (const category of menu.categories) {
    for (const product of category.products) kinds.set(product.id, productKind(product, category));
  }
  return kinds;
}

function knownKind(value: string | null | undefined): CategoryKind | null {
  return value && (CATEGORY_KINDS as readonly string[]).includes(value) ? (value as CategoryKind) : null;
}
