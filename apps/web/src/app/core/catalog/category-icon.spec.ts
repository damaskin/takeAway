import { DEFAULT_CATEGORY_ICON, categoryIcon } from './category-icon';

describe('categoryIcon', () => {
  it.each([
    ['Кофейные напитки', '☕'],
    ['Некофейные напитки', '🧃'],
    ['Чаи', '🍵'],
    ['Молочные коктейли', '🥛'],
    ['Коктейли', '🍹'],
    ['Холодные напитки', '🧊'],
    ['Не "глинтвейн"', '🍷'],
    ['Вода', '💧'],
    ['Завтраки', '🍳'],
    ['Дополнительные ингредиенты', '✨'],
    ['Пряники', '🍪'],
    ['Смузи', '🥤'],
    ['Мороженое', '🍨'],
    ['Iced coffee', '🧊'],
    ['Ice cream', '🍨'],
    ['Green tea', '🍵'],
    ['Steak', DEFAULT_CATEGORY_ICON],
  ])('%s → %s', (name, icon) => {
    expect(categoryIcon(name)).toBe(icon);
  });
});
