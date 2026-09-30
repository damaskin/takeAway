/**
 * An emoji for a menu category, guessed from its name. Categories arrive
 * from the café's POS with names only — «Кофейные напитки», «Некофейные
 * напитки», «Молочные коктейли» — so the rules run in order, the specific
 * ones first: «некофейные» before «кофе», «молочные коктейли» before
 * «коктейли», «мороженое» before anything cold.
 */
const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/некофейн|без\s*кофеина|decaf|non-?coffee/, '🧃'],
  [/молочн\S*\s+коктейл|милкшейк|milk\s*shake/, '🥛'],
  [/смузи|smoothie/, '🥤'],
  [/глинтвейн|mulled/, '🍷'],
  [/морожен|ice\s*cream|gelato/, '🍨'],
  [/лимонад|lemonade/, '🍋'],
  [/зерн|\bbeans?\b/, '🫘'],
  [/холодн|(^|\s)айс|\biced?\b|фраппе|frapp/, '🧊'],
  [/коктейл|cocktail|мохито|mojito/, '🍹'],
  [/(^|\s)вод[аы]|\bwater\b/, '💧'],
  [/(^|\s)сок|фреш|\bjuices?\b/, '🧃'],
  [/(^|\s)ча[йи]|\bteas?\b|матч|matcha/, '🍵'],
  [/какао|шоколад|cocoa|chocolate/, '🍫'],
  [/коф|эспрессо|латте|капучино|coffee|espresso/, '☕'],
  [/завтрак|breakfast|омлет|сырник|pancake/, '🍳'],
  [/сэндвич|сендвич|бутерброд|sandwich|панини|тост|toast|бургер|burger|шаурм|\bwraps?\b/, '🥪'],
  [/салат|salad|боул|\bbowls?\b/, '🥗'],
  [/(^|\s)суп|\bsoups?\b/, '🍲'],
  [/пицц|pizza/, '🍕'],
  [/выпечк|круассан|булоч|хлеб|pastr|bakery|croissant|bread/, '🥐'],
  [/пряник|печень|cookie|gingerbread/, '🍪'],
  [/десерт|торт|пирожн|чизкейк|сладк|dessert|cake|sweet/, '🍰'],
  [/снек|закуск|snack/, '🥨'],
  [/добав|дополн|ингредиент|топпинг|сироп|extra|add-?on|topping|syrup/, '✨'],
];

export const DEFAULT_CATEGORY_ICON = '🍽️';

export function categoryIcon(name: string): string {
  const text = name.toLowerCase().replace(/ё/g, 'е');
  for (const [pattern, icon] of RULES) {
    if (pattern.test(text)) return icon;
  }
  return DEFAULT_CATEGORY_ICON;
}
