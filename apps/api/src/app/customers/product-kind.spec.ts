import { type ProductKindSignals, productKind } from './product-kind';

const product = (over: Partial<ProductKindSignals>): ProductKindSignals => ({
  name: 'Позиция',
  categoryName: null,
  caffeineLevel: null,
  drinkOptions: false,
  ...over,
});

describe('productKind', () => {
  it('goes by the kind the business gave the category', () => {
    expect(productKind(product({ categoryKind: 'COLD_DRINKS', categoryName: 'Сезонное' }))).toBe('DRINK');
    expect(productKind(product({ categoryKind: 'BAKERY', caffeineLevel: 1 }))).toBe('FOOD');
    expect(productKind(product({ categoryKind: 'FOOD', name: 'Латте-шаурма' }))).toBe('FOOD');
    // OTHER says nothing: the other signals decide.
    expect(productKind(product({ categoryKind: 'OTHER', categoryName: 'Горячие напитки' }))).toBe('DRINK');
  });

  it('trusts caffeine and drink options first', () => {
    expect(productKind(product({ caffeineLevel: 0, categoryName: 'Десерты' }))).toBe('DRINK');
    expect(productKind(product({ drinkOptions: true }))).toBe('DRINK');
  });

  it('reads the category name', () => {
    expect(productKind(product({ categoryName: 'Горячие напитки' }))).toBe('DRINK');
    expect(productKind(product({ categoryName: 'Чай и какао' }))).toBe('DRINK');
    expect(productKind(product({ categoryName: 'Coffee' }))).toBe('DRINK');
    expect(productKind(product({ categoryName: 'Выпечка' }))).toBe('FOOD');
    expect(productKind(product({ categoryName: 'Sandwiches' }))).toBe('FOOD');
  });

  it('falls back to the product name', () => {
    expect(productKind(product({ name: 'Латте на овсяном', categoryName: 'Хиты' }))).toBe('DRINK');
    expect(productKind(product({ name: 'Круассан с миндалём', categoryName: 'Хиты' }))).toBe('FOOD');
  });

  it('matches whole words, not letters inside them', () => {
    expect(productKind(product({ name: 'Steak', categoryName: 'Grill' }))).toBeNull();
  });

  it('says nothing when nothing points either way', () => {
    expect(productKind(product({ name: 'Сет №3', categoryName: 'Акции' }))).toBeNull();
  });
});
