import { convertToParamMap } from '@angular/router';

import { campaignLink, customersLink, inactiveDaysFromQuery, parseInactiveDays, promoLink } from './inactive-segment';

describe('inactive segment links', () => {
  const segment = { days: 30, storeId: 's1' } as const;

  it('reads any whole number of days from 1 to 365, the old 3 too', () => {
    expect(parseInactiveDays('3')).toBe(3);
    expect(parseInactiveDays('30')).toBe(30);
    expect(parseInactiveDays('45')).toBe(45);
    expect(parseInactiveDays('0')).toBeNull();
    expect(parseInactiveDays('400')).toBeNull();
    expect(parseInactiveDays(null)).toBeNull();
  });

  it('takes `inactiveDays` first and the older names after it', () => {
    expect(inactiveDaysFromQuery(convertToParamMap({ inactiveDays: '30', window: '7' }), 'window')).toBe(30);
    expect(inactiveDaysFromQuery(convertToParamMap({ window: '3' }), 'window')).toBe(3);
    expect(inactiveDaysFromQuery(convertToParamMap({ days: '7' }), 'days')).toBe(7);
    expect(inactiveDaysFromQuery(convertToParamMap({ days: '7' }))).toBeNull();
    expect(inactiveDaysFromQuery(convertToParamMap({ inactiveDays: 'x' }), 'window')).toBeNull();
  });

  it('opens the customers list, the composer and the promo form on the same people', () => {
    expect(customersLink(segment)).toEqual({
      commands: ['/customers'],
      queryParams: { segment: 'inactive', inactiveDays: 30, storeId: 's1' },
    });
    expect(campaignLink(segment, 'BACK15')).toEqual({
      commands: ['/campaigns/new'],
      queryParams: { audience: 'INACTIVE', inactiveDays: 30, storeId: 's1', code: 'BACK15' },
    });
    expect(promoLink({ days: 14, storeId: null }, 'campaign')).toEqual({
      commands: ['/promotions/promo/new'],
      queryParams: { for: 'inactive', inactiveDays: 14, storeId: undefined, then: 'campaign' },
    });
  });
});
