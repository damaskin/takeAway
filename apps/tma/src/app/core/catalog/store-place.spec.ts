import { hasLocation, sortStoresByDistance, storeAddress, storeMatchesQuery } from './store-place';

describe('store place', () => {
  const centre = { name: 'NoName Centre', addressLine: 'ул. Ленина 1', city: 'Тирасполь' };

  it('finds a store by any words of its name or address', () => {
    expect(storeMatchesQuery(centre, '')).toBe(true);
    expect(storeMatchesQuery(centre, 'ленина')).toBe(true);
    expect(storeMatchesQuery(centre, 'noname  тирасполь')).toBe(true);
    expect(storeMatchesQuery(centre, 'бендеры')).toBe(false);
  });

  it('leaves out an address the café left as dashes', () => {
    expect(storeAddress({ addressLine: '—', city: 'Тирасполь' })).toBe('Тирасполь');
    expect(storeAddress({ addressLine: ' - ', city: '' })).toBe('');
  });

  it('keeps a store still at 0,0 off the map', () => {
    expect(hasLocation({ latitude: 0, longitude: 0 })).toBe(false);
    expect(hasLocation({ latitude: 46.84, longitude: 29.62 })).toBe(true);
  });

  it('puts the nearest first, stores without a distance after them in the API’s order', () => {
    const list = [
      { id: 'a', distanceMeters: null },
      { id: 'b', distanceMeters: 1200 },
      { id: 'c', distanceMeters: 300 },
      { id: 'd', distanceMeters: null },
    ];
    expect(sortStoresByDistance(list).map((s) => s.id)).toEqual(['c', 'b', 'a', 'd']);
  });
});
