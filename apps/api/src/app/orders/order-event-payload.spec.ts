import { withoutCoordinates } from './order-event-payload';

describe('withoutCoordinates', () => {
  it('drops lat/lng (and their long names) and keeps everything else', () => {
    expect(withoutCoordinates({ distanceM: 12.5, lat: 46.84, lng: 29.63 })).toEqual({ distanceM: 12.5 });
    expect(withoutCoordinates({ distanceM: 3, latitude: 1, longitude: 2, source: 'gps' })).toEqual({
      distanceM: 3,
      source: 'gps',
    });
  });

  it('hands back the very same value when there is nothing to drop', () => {
    const payload = { from: 'CREATED', to: 'PAID' };
    expect(withoutCoordinates(payload)).toBe(payload);
    expect(withoutCoordinates(null)).toBeNull();
    expect(withoutCoordinates('text')).toBe('text');
    const list = [{ lat: 1 }];
    expect(withoutCoordinates(list)).toBe(list);
  });

  it('does not touch the stored object', () => {
    const payload = { distanceM: 1, lat: 2, lng: 3 };
    withoutCoordinates(payload);
    expect(payload).toEqual({ distanceM: 1, lat: 2, lng: 3 });
  });
});
