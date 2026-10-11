import { isPromoEditable, promoEffectiveStatus, promoNextStatuses } from './promo-status';

const NOW = new Date('2026-10-10T12:00:00Z');
const day = (offset: number) => new Date(NOW.getTime() + offset * 24 * 60 * 60_000).toISOString();
const promo = (status: Parameters<typeof promoEffectiveStatus>[0]['status'], startsAt = day(-1), endsAt = day(7)) => ({
  status,
  startsAt,
  endsAt,
});

describe('promoEffectiveStatus', () => {
  it('reads an active promo by its dates', () => {
    expect(promoEffectiveStatus(promo('SCHEDULED'), NOW)).toBe('RUNNING');
    expect(promoEffectiveStatus(promo('RUNNING', day(2)), NOW)).toBe('SCHEDULED');
    expect(promoEffectiveStatus(promo('RUNNING', day(-9), day(-1)), NOW)).toBe('EXPIRED');
  });

  it('ends a paused promo at its end date and leaves a draft a draft', () => {
    expect(promoEffectiveStatus(promo('PAUSED', day(-9), day(-1)), NOW)).toBe('EXPIRED');
    expect(promoEffectiveStatus(promo('PAUSED'), NOW)).toBe('PAUSED');
    expect(promoEffectiveStatus(promo('DRAFT', day(-9), day(-1)), NOW)).toBe('DRAFT');
  });
});

describe('promoNextStatuses', () => {
  it('walks draft → active → paused → ended', () => {
    expect(promoNextStatuses(promo('DRAFT'), NOW)).toEqual(['RUNNING']);
    expect(promoNextStatuses(promo('RUNNING'), NOW)).toEqual(['PAUSED', 'EXPIRED']);
    expect(promoNextStatuses(promo('PAUSED'), NOW)).toEqual(['RUNNING', 'EXPIRED']);
    expect(promoNextStatuses(promo('EXPIRED'), NOW)).toEqual([]);
  });
});

describe('isPromoEditable', () => {
  it('edits drafts, and scheduled or paused promos nobody used', () => {
    expect(isPromoEditable({ ...promo('DRAFT'), redemptionsCount: 0 }, NOW)).toBe(true);
    expect(isPromoEditable({ ...promo('RUNNING', day(3)), redemptionsCount: 0 }, NOW)).toBe(true);
    expect(isPromoEditable({ ...promo('PAUSED'), redemptionsCount: 0 }, NOW)).toBe(true);
  });

  it('freezes a running promo, a used one and an ended one', () => {
    expect(isPromoEditable({ ...promo('RUNNING'), redemptionsCount: 0 }, NOW)).toBe(false);
    expect(isPromoEditable({ ...promo('PAUSED'), redemptionsCount: 2 }, NOW)).toBe(false);
    expect(isPromoEditable({ ...promo('EXPIRED'), redemptionsCount: 0 }, NOW)).toBe(false);
  });
});
