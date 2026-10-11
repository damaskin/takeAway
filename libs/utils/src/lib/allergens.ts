import { ALLERGENS, type AllergenCode, type AllergenInfo } from '@takeaway/shared-types';

const BY_CODE = new Map<string, AllergenInfo>(ALLERGENS.map((a) => [a.code, a]));

/**
 * The allergen an entry of `Product.allergens` stands for: a code from the
 * editor's checklist, or free text that names one («молоко», «Milk»). Null
 * for anything else — that entry is shown as typed.
 */
export function allergenCodeOf(value: string): AllergenCode | null {
  const coded = BY_CODE.get(value);
  if (coded) return coded.code;
  const text = value.trim().toLowerCase();
  if (!text) return null;
  const named = ALLERGENS.find(
    (a) => a.ru.toLowerCase() === text || a.en.toLowerCase() === text || a.aliases.includes(text),
  );
  return named?.code ?? null;
}

/**
 * How to print an entry of `Product.allergens`: a code by its name in the
 * customer's language, free text exactly as the business typed it.
 */
export function allergenLabel(value: string, lang: string | null | undefined): string {
  const coded = BY_CODE.get(value);
  if (!coded) return value;
  return lang?.toLowerCase().startsWith('ru') ? coded.ru : coded.en;
}
