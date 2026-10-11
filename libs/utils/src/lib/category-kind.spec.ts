import type { CategoryKind } from '@takeaway/shared-types';

import { CATEGORY_KIND_STEMS, categoryKindPattern, inferCategoryKind } from './category-kind';

/** Category names seen in cafés and fast-food menus, with the kind a person would pick. */
const TYPICAL_CATEGORY_NAMES: ReadonlyArray<readonly [string, CategoryKind]> = [
  ['Кофе', 'HOT_DRINKS'],
  ['Кофе с собой', 'HOT_DRINKS'],
  ['Кофейные напитки', 'HOT_DRINKS'],
  ['Классический кофе', 'HOT_DRINKS'],
  ['Капучино и латте', 'HOT_DRINKS'],
  ['Раф', 'HOT_DRINKS'],
  ['Чай', 'HOT_DRINKS'],
  ['Чайные напитки', 'HOT_DRINKS'],
  ['Какао и горячий шоколад', 'HOT_DRINKS'],
  ['Горячие напитки', 'HOT_DRINKS'],
  ['Coffee', 'HOT_DRINKS'],
  ['Hot drinks', 'HOT_DRINKS'],
  ['Tea', 'HOT_DRINKS'],
  ['Холодные напитки', 'COLD_DRINKS'],
  ['Холодный кофе', 'COLD_DRINKS'],
  ['Айс латте', 'COLD_DRINKS'],
  ['Кофе со льдом', 'COLD_DRINKS'],
  ['Лимонады', 'COLD_DRINKS'],
  ['Смузи', 'COLD_DRINKS'],
  ['Молочные коктейли', 'COLD_DRINKS'],
  ['Милкшейки', 'COLD_DRINKS'],
  ['Фраппе', 'COLD_DRINKS'],
  ['Вода и соки', 'COLD_DRINKS'],
  ['Газировка', 'COLD_DRINKS'],
  ['Iced coffee', 'COLD_DRINKS'],
  ['Cold drinks', 'COLD_DRINKS'],
  ['Шаурма', 'FOOD'],
  ['Шаверма', 'FOOD'],
  ['Бургеры', 'FOOD'],
  ['Сэндвичи', 'FOOD'],
  ['Хот-доги', 'FOOD'],
  ['Завтраки', 'FOOD'],
  ['Салаты', 'FOOD'],
  ['Супы', 'FOOD'],
  ['Пицца', 'FOOD'],
  ['Роллы', 'FOOD'],
  ['Фастфуд', 'FOOD'],
  ['Горячие блюда', 'FOOD'],
  ['Холодные закуски', 'FOOD'],
  ['Бизнес-ланч', 'FOOD'],
  ['Еда', 'FOOD'],
  ['Food', 'FOOD'],
  ['Hot dogs', 'FOOD'],
  ['Выпечка', 'BAKERY'],
  ['Десерты', 'BAKERY'],
  ['Круассаны', 'BAKERY'],
  ['Торты', 'BAKERY'],
  ['Пирожные', 'BAKERY'],
  ['Печенье', 'BAKERY'],
  ['Маффины и кексы', 'BAKERY'],
  ['Чизкейки', 'BAKERY'],
  ['Пряники', 'BAKERY'],
  ['Bakery', 'BAKERY'],
  ['Desserts', 'BAKERY'],
  ['Новинки', 'OTHER'],
  ['Сезонное меню', 'OTHER'],
  ['Дополнительные ингредиенты', 'OTHER'],
  ['Сиропы', 'OTHER'],
  ['Мерч', 'OTHER'],
  ['Комбо', 'OTHER'],
];

describe('inferCategoryKind', () => {
  it.each(TYPICAL_CATEGORY_NAMES)('reads «%s» as %s', (name, kind) => {
    expect(inferCategoryKind(name)).toBe(kind);
  });

  it('ignores case, in both alphabets', () => {
    expect(inferCategoryKind('КОФЕ')).toBe('HOT_DRINKS');
    expect(inferCategoryKind('DESSERTS')).toBe('BAKERY');
  });

  it('matches word beginnings only', () => {
    // «чай» inside «случайный», «еда» inside «среда», «айс» inside «прайс».
    expect(inferCategoryKind('Случайный выбор')).toBe('OTHER');
    expect(inferCategoryKind('Меню среды')).toBe('OTHER');
    expect(inferCategoryKind('Прайс')).toBe('OTHER');
  });

  it('says OTHER for nothing at all', () => {
    expect(inferCategoryKind('')).toBe('OTHER');
    expect(inferCategoryKind('   ')).toBe('OTHER');
    expect(inferCategoryKind(null)).toBe('OTHER');
  });

  it('builds patterns PostgreSQL reads the same way: no classes or escapes beyond the shared ones', () => {
    for (const [, stems] of CATEGORY_KIND_STEMS) {
      for (const stem of stems) expect(stem).toMatch(/^[a-zа-яё -]+(\?[a-zа-яё]+)?$|^[a-zа-яё]+-\?[a-zа-яё]+$/);
      expect(categoryKindPattern(stems)).toBe(`(^|[^a-zа-яё])(${stems.join('|')})`);
    }
  });
});
