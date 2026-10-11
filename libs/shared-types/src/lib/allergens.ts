/**
 * The allergens the product editor offers as a checklist — the fourteen a
 * menu in the EU has to declare, in the order a café meets them. A product
 * stores the codes in `Product.allergens` next to any free text a business
 * typed before the checklist existed («молоко, орехи»); clients show a code
 * by its name in the customer's language (`allergenLabel` in
 * `@takeaway/utils`) and free text as it is.
 */
export type AllergenCode =
  | 'MILK'
  | 'GLUTEN'
  | 'EGGS'
  | 'NUTS'
  | 'PEANUTS'
  | 'SOY'
  | 'SESAME'
  | 'FISH'
  | 'CRUSTACEANS'
  | 'MOLLUSCS'
  | 'CELERY'
  | 'MUSTARD'
  | 'SULPHITES'
  | 'LUPIN';

export interface AllergenInfo {
  code: AllergenCode;
  ru: string;
  en: string;
  /**
   * Other words a business may have typed for it, lower case. A free-text
   * entry equal to the name or one of these counts as this allergen.
   */
  aliases: readonly string[];
}

export const ALLERGENS: readonly AllergenInfo[] = [
  {
    code: 'MILK',
    ru: 'Молоко',
    en: 'Milk',
    aliases: ['молоко', 'лактоза', 'молочные продукты', 'milk', 'lactose', 'dairy'],
  },
  { code: 'GLUTEN', ru: 'Глютен', en: 'Gluten', aliases: ['глютен', 'пшеница', 'gluten', 'wheat'] },
  { code: 'EGGS', ru: 'Яйца', en: 'Eggs', aliases: ['яйца', 'яйцо', 'eggs', 'egg'] },
  { code: 'NUTS', ru: 'Орехи', en: 'Tree nuts', aliases: ['орехи', 'орех', 'nuts', 'tree nuts', 'nut'] },
  { code: 'PEANUTS', ru: 'Арахис', en: 'Peanuts', aliases: ['арахис', 'peanuts', 'peanut'] },
  { code: 'SOY', ru: 'Соя', en: 'Soy', aliases: ['соя', 'soy', 'soya'] },
  { code: 'SESAME', ru: 'Кунжут', en: 'Sesame', aliases: ['кунжут', 'sesame'] },
  { code: 'FISH', ru: 'Рыба', en: 'Fish', aliases: ['рыба', 'fish'] },
  {
    code: 'CRUSTACEANS',
    ru: 'Ракообразные',
    en: 'Crustaceans',
    aliases: ['ракообразные', 'креветки', 'crustaceans', 'shrimp'],
  },
  { code: 'MOLLUSCS', ru: 'Моллюски', en: 'Molluscs', aliases: ['моллюски', 'molluscs', 'mollusks'] },
  { code: 'CELERY', ru: 'Сельдерей', en: 'Celery', aliases: ['сельдерей', 'celery'] },
  { code: 'MUSTARD', ru: 'Горчица', en: 'Mustard', aliases: ['горчица', 'mustard'] },
  { code: 'SULPHITES', ru: 'Сульфиты', en: 'Sulphites', aliases: ['сульфиты', 'sulphites', 'sulfites'] },
  { code: 'LUPIN', ru: 'Люпин', en: 'Lupin', aliases: ['люпин', 'lupin'] },
];
