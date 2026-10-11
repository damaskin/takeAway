import { campaignLink, customersLink, parseInactiveDays, promoLink } from './inactive-segment';

describe('inactive segment links', () => {
  const segment = { days: 7, storeId: 's1' } as const;

  it('reads only the windows the API knows', () => {
    expect(parseInactiveDays('3')).toBe(3);
    expect(parseInactiveDays('14')).toBe(14);
    expect(parseInactiveDays('30')).toBeNull();
    expect(parseInactiveDays(null)).toBeNull();
  });

  it('opens the customers list, the composer and the promo form on the same people', () => {
    expect(customersLink(segment)).toEqual({
      commands: ['/customers'],
      queryParams: { segment: 'inactive', days: 7, storeId: 's1' },
    });
    expect(campaignLink(segment, 'BACK15')).toEqual({
      commands: ['/campaigns/new'],
      queryParams: { audience: 'INACTIVE', inactiveDays: 7, storeId: 's1', code: 'BACK15' },
    });
    expect(promoLink({ days: 14, storeId: null }, 'campaign')).toEqual({
      commands: ['/promotions/promo/new'],
      queryParams: { for: 'inactive', inactiveDays: 14, storeId: undefined, then: 'campaign' },
    });
  });
});
