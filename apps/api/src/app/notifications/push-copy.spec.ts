import { titleWithSender, truncate } from './push-copy';

describe('titleWithSender', () => {
  it('puts the sender before the title', () => {
    expect(titleWithSender('NoName Coffee', '−20% на капучино')).toBe('NoName Coffee: −20% на капучино');
  });

  it('shortens a long brand name first, then the whole line', () => {
    const title = titleWithSender('Кофейня с очень-очень длинным названием у самого моря', 'Скидка');
    expect(title).toBe('Кофейня с очень-очень длинным н…: Скидка');
    expect(Array.from(titleWithSender('Bar', 'x'.repeat(300)))).toHaveLength(110);
    expect(titleWithSender('Bar', 'x'.repeat(300)).endsWith('…')).toBe(true);
  });

  it('leaves the title alone without a sender', () => {
    expect(titleWithSender('  ', ' Акция ')).toBe('Акция');
  });
});

describe('truncate', () => {
  it('never splits an emoji', () => {
    expect(truncate('☕☕☕☕', 3)).toBe('☕☕…');
    expect(truncate('☕☕', 3)).toBe('☕☕');
  });
});
