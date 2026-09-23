import { slugify, uniqueSlug } from './slug';

describe('slugify', () => {
  it('transliterates Russian instead of dropping it', () => {
    expect(slugify('Ванильный сироп')).toBe('vanilnyy-sirop');
    expect(slugify('Кофейня Ромашка')).toBe('kofeynya-romashka');
    expect(slugify('Щербет и ёжик')).toBe('scherbet-i-ezhik');
  });

  it('folds Romanian diacritics and keeps latin and digits', () => {
    expect(slugify('Cafenea Știință 25 ml')).toBe('cafenea-stiinta-25-ml');
    expect(slugify('Flat White')).toBe('flat-white');
  });

  it('never leaves a leading, trailing or doubled hyphen, even when cut', () => {
    expect(slugify('  —  Латте  (большой)  ')).toBe('latte-bolshoy');
    expect(slugify('ab cd', 3)).toBe('ab');
  });

  it('is empty when nothing is transliterable', () => {
    expect(slugify('☕✨')).toBe('');
  });
});

describe('uniqueSlug', () => {
  it('numbers the slug until it is free', async () => {
    const taken = new Set(['latte', 'latte-2']);
    await expect(uniqueSlug('Латте', async (s) => taken.has(s))).resolves.toBe('latte-3');
  });

  it('falls back when the name has no usable characters', async () => {
    await expect(uniqueSlug('☕', async () => false, 'product')).resolves.toBe('product');
  });
});
