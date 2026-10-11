import { ALLERGEN_CODES, allergenChips, allergenCode } from './allergens';

describe('allergenCode', () => {
  it('knows every listed code, whatever the case', () => {
    for (const code of ALLERGEN_CODES) {
      expect(allergenCode(code)).toBe(code);
      expect(allergenCode(code.toLowerCase())).toBe(code);
    }
  });

  it('reads other spellings of the same allergen', () => {
    expect(allergenCode('egg')).toBe('EGGS');
    expect(allergenCode('Tree nuts')).toBe('NUTS');
    expect(allergenCode('tree-nuts')).toBe('NUTS');
    expect(allergenCode('sulfites')).toBe('SULPHITES');
    expect(allergenCode(' soya ')).toBe('SOY');
  });

  it('does not guess at free text', () => {
    expect(allergenCode('молоко')).toBeNull();
    expect(allergenCode('lupin')).toBeNull();
    expect(allergenCode('')).toBeNull();
  });
});

describe('allergenChips', () => {
  it('keeps known codes as codes and anything else as written', () => {
    expect(allergenChips(['GLUTEN', 'орехи'])).toEqual([
      { code: 'GLUTEN', text: 'GLUTEN' },
      { code: null, text: 'орехи' },
    ]);
  });

  it('drops blanks and repeats', () => {
    expect(allergenChips(['milk', 'MILK', ' ', 'Орехи', 'орехи']).map((c) => c.code ?? c.text)).toEqual([
      'MILK',
      'Орехи',
    ]);
  });

  it('copes with a product that lists none', () => {
    expect(allergenChips([])).toEqual([]);
    expect(allergenChips(null)).toEqual([]);
  });
});
