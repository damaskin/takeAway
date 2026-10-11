/**
 * Allergens the apps name in the customer's language. A product's
 * `allergens` is free text — the admin takes "молоко, орехи" as typed, and a
 * POS may send codes — so a value is matched to a code when it is one, and
 * shown as it is otherwise.
 */
export type AllergenCode =
  | 'GLUTEN'
  | 'MILK'
  | 'LACTOSE'
  | 'EGGS'
  | 'NUTS'
  | 'PEANUTS'
  | 'SOY'
  | 'FISH'
  | 'SHELLFISH'
  | 'SESAME'
  | 'CELERY'
  | 'MUSTARD'
  | 'SULPHITES';

export const ALLERGEN_CODES: readonly AllergenCode[] = [
  'GLUTEN',
  'MILK',
  'LACTOSE',
  'EGGS',
  'NUTS',
  'PEANUTS',
  'SOY',
  'FISH',
  'SHELLFISH',
  'SESAME',
  'CELERY',
  'MUSTARD',
  'SULPHITES',
];

/** Other spellings of the same codes: singular forms, US spelling, the EU list's names. */
const ALIASES: Readonly<Record<string, AllergenCode>> = {
  EGG: 'EGGS',
  NUT: 'NUTS',
  TREE_NUTS: 'NUTS',
  PEANUT: 'PEANUTS',
  SOYA: 'SOY',
  CRUSTACEANS: 'SHELLFISH',
  SULPHITE: 'SULPHITES',
  SULFITE: 'SULPHITES',
  SULFITES: 'SULPHITES',
};

/** One allergen to show: a known code to translate, or the text as the business wrote it. */
export interface AllergenChip {
  code: AllergenCode | null;
  text: string;
}

/** "tree nuts", "Tree-Nuts", "TREE_NUTS" → NUTS; anything else → null. */
export function allergenCode(value: string): AllergenCode | null {
  const key = value
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  if ((ALLERGEN_CODES as readonly string[]).includes(key)) return key as AllergenCode;
  return ALIASES[key] ?? null;
}

/** The product's allergens as chips, blanks dropped and each one once, in the order given. */
export function allergenChips(values: readonly string[] | null | undefined): AllergenChip[] {
  const seen = new Set<string>();
  const chips: AllergenChip[] = [];
  for (const value of values ?? []) {
    const text = value.trim();
    if (!text) continue;
    const code = allergenCode(text);
    const key = code ?? text.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    chips.push({ code, text });
  }
  return chips;
}
