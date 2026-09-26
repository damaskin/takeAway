import { hasLocation, storeAddress } from './store-place';

describe('storeAddress', () => {
  it('joins the street and the city', () => {
    expect(storeAddress({ addressLine: 'Ленина 1', city: 'Тирасполь' })).toBe('Ленина 1, Тирасполь');
  });

  it('drops the dashes a POS import leaves in empty fields', () => {
    expect(storeAddress({ addressLine: '—', city: '—' })).toBe('');
    expect(storeAddress({ addressLine: ' - ', city: 'Тирасполь' })).toBe('Тирасполь');
  });
});

describe('hasLocation', () => {
  it('is false for a store still at 0,0', () => {
    expect(hasLocation({ latitude: 0, longitude: 0 })).toBe(false);
  });

  it('is true for a real pin', () => {
    expect(hasLocation({ latitude: 46.838, longitude: 29.624 })).toBe(true);
  });
});
