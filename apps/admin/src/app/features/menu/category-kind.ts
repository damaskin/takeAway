import { ALLERGENS, type AllergenCode, type CategoryKind } from '@takeaway/shared-types';
import { allergenCodeOf } from '@takeaway/utils';

import type { DietTag, VariationType } from '../../core/catalog/admin-catalog.service';

/** Every diet tag, in the order the editor lists them. */
export const ALL_DIET_TAGS: readonly DietTag[] = [
  'VEGAN',
  'VEGETARIAN',
  'GLUTEN_FREE',
  'LACTOSE_FREE',
  'DECAF',
  'SUGAR_FREE',
];

const DRINK_DIET_TAGS: readonly DietTag[] = ['VEGAN', 'LACTOSE_FREE', 'SUGAR_FREE', 'DECAF'];
const FOOD_DIET_TAGS: readonly DietTag[] = ['VEGAN', 'VEGETARIAN', 'GLUTEN_FREE', 'LACTOSE_FREE'];
const ALL_VARIATION_TYPES: readonly VariationType[] = ['SIZE', 'TEMPERATURE', 'MILK', 'CUP'];

/** What the product editor offers for a product of a category kind. */
export interface ProductFields {
  /** The caffeine level select — drinks only. */
  caffeine: boolean;
  /** Diet tags that mean something for the kind: no «Без кофеина» on a shawarma. */
  dietTags: readonly DietTag[];
  /** Choice groups the options editor can add: milk and cups are for drinks. */
  variationTypes: readonly VariationType[];
}

/**
 * The fields of a product of this kind. OTHER (and a category from an API
 * without kinds) keeps everything, as the editor was before kinds.
 */
export function productFieldsFor(kind: CategoryKind | null | undefined): ProductFields {
  switch (kind) {
    case 'HOT_DRINKS':
    case 'COLD_DRINKS':
      return { caffeine: true, dietTags: DRINK_DIET_TAGS, variationTypes: ALL_VARIATION_TYPES };
    case 'FOOD':
    case 'BAKERY':
      return { caffeine: false, dietTags: FOOD_DIET_TAGS, variationTypes: ['SIZE'] };
    default:
      return { caffeine: true, dietTags: ALL_DIET_TAGS, variationTypes: ALL_VARIATION_TYPES };
  }
}

/**
 * Values a product keeps in fields its kind does not show — a latte moved
 * to «Выпечка» still has its caffeine level. They are saved as they are;
 * the editor names them so the owner can clear them on purpose.
 */
export function hiddenProductData(
  kind: CategoryKind | null | undefined,
  values: { caffeineLevel: string | number | null; dietTags: readonly DietTag[] },
): { caffeine: boolean; dietTags: DietTag[] } {
  const fields = productFieldsFor(kind);
  const hasCaffeine = values.caffeineLevel !== null && values.caffeineLevel !== '';
  return {
    caffeine: !fields.caffeine && hasCaffeine,
    dietTags: values.dietTags.filter((tag) => !fields.dietTags.includes(tag)),
  };
}

/**
 * A product's allergens as the checklist reads them: the boxes ticked
 * (codes), the free-text entries that name one of them (kept as typed
 * while the box stays ticked) and everything else, shown in «Другие».
 */
export interface AllergenState {
  codes: AllergenCode[];
  /** Free text that names a checklist allergen, by its code («молоко» → MILK). */
  legacy: Partial<Record<AllergenCode, string[]>>;
  other: string[];
}

export function splitAllergens(values: readonly string[]): AllergenState {
  const state: AllergenState = { codes: [], legacy: {}, other: [] };
  for (const value of values) {
    const code = allergenCodeOf(value);
    if (!code) {
      state.other.push(value);
      continue;
    }
    if (!state.codes.includes(code)) state.codes.push(code);
    if (value !== code) state.legacy[code] = [...(state.legacy[code] ?? []), value];
  }
  return state;
}

/**
 * What to store: each ticked allergen — as the free text it came in as, or
 * as its code — in checklist order, then the other entries. Nothing a
 * business typed is rewritten behind its back; unticking a box drops it.
 */
export function joinAllergens(state: Pick<AllergenState, 'codes' | 'legacy'>, other: readonly string[]): string[] {
  const out: string[] = [];
  for (const { code } of ALLERGENS) {
    if (!state.codes.includes(code)) continue;
    out.push(...(state.legacy[code]?.length ? (state.legacy[code] ?? []) : [code]));
  }
  for (const value of other) {
    if (!out.some((v) => v.toLocaleLowerCase() === value.toLocaleLowerCase())) out.push(value);
  }
  return out;
}
