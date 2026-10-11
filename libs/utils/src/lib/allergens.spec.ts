import { allergenCodeOf, allergenLabel } from './allergens';

describe('allergens', () => {
  it('reads a checklist code and the words a business typed for the same allergen', () => {
    expect(allergenCodeOf('MILK')).toBe('MILK');
    expect(allergenCodeOf('молоко')).toBe('MILK');
    expect(allergenCodeOf(' Орехи ')).toBe('NUTS');
    expect(allergenCodeOf('Gluten')).toBe('GLUTEN');
    expect(allergenCodeOf('лактоза')).toBe('MILK');
  });

  it('leaves anything else as free text', () => {
    expect(allergenCodeOf('следы горчичного масла')).toBeNull();
    expect(allergenCodeOf('')).toBeNull();
    expect(allergenCodeOf('milk ')).toBe('MILK');
  });

  it('prints a code in the customer language and free text as typed', () => {
    expect(allergenLabel('MILK', 'ru')).toBe('Молоко');
    expect(allergenLabel('MILK', 'en')).toBe('Milk');
    expect(allergenLabel('MILK', 'ru-RU')).toBe('Молоко');
    expect(allergenLabel('PEANUTS', null)).toBe('Peanuts');
    expect(allergenLabel('молоко', 'en')).toBe('молоко');
  });
});
