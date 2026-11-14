import {
  isValidTakeawayPromoPercent,
  takeawayDebtStatus,
  takeawayPromoBudgetFits,
  takeawayPromoDiscountCents,
  takeawayPromoSplit,
  welcomeBonusMessage,
} from './takeaway-promo';

describe('takeaway promo money', () => {
  // The table of section 3 of «Учёт акций takeAway».
  it.each([
    [10000, 10, 1000, 9000],
    [1500, 10, 150, 1350],
    [4500, 10, 450, 4050],
    [1555, 10, 156, 1399],
  ])('P=%i at %i%% → D=%i, guest pays %i', (menu, percent, discount, paid) => {
    expect(takeawayPromoDiscountCents(menu, percent)).toBe(discount);
    expect(takeawayPromoSplit(menu, percent)).toEqual({
      discountCents: discount,
      paidByGuestCents: paid,
      compensationCents: discount,
    });
  });

  it('rounds half up to the cent, never like a float', () => {
    // 15.55 × 10 % = 1.555 → 1.56; in floats it would come out 1.55.
    expect(takeawayPromoDiscountCents(1555, 10)).toBe(156);
    expect(takeawayPromoDiscountCents(1554, 10)).toBe(155);
    expect(takeawayPromoDiscountCents(1, 49)).toBe(0);
    expect(takeawayPromoDiscountCents(1, 50)).toBe(1);
    expect(takeawayPromoDiscountCents(0, 10)).toBe(0);
  });

  it('keeps something to pay by card at 99 %', () => {
    expect(takeawayPromoSplit(10000, 99)).toEqual({
      discountCents: 9900,
      paidByGuestCents: 100,
      compensationCents: 9900,
    });
  });

  it('accepts whole percents from 1 to 99 only', () => {
    expect(isValidTakeawayPromoPercent(1)).toBe(true);
    expect(isValidTakeawayPromoPercent(99)).toBe(true);
    expect(isValidTakeawayPromoPercent(0)).toBe(false);
    expect(isValidTakeawayPromoPercent(100)).toBe(false);
    expect(isValidTakeawayPromoPercent(10.5)).toBe(false);
    expect(() => takeawayPromoDiscountCents(1000, 100)).toThrow(RangeError);
    expect(() => takeawayPromoDiscountCents(-1, 10)).toThrow(RangeError);
    expect(() => takeawayPromoDiscountCents(10.5, 10)).toThrow(RangeError);
  });

  it('refuses a discount larger than what is left of the budget', () => {
    expect(takeawayPromoBudgetFits(10000, 9000, 1000)).toBe(true);
    expect(takeawayPromoBudgetFits(10000, 9001, 1000)).toBe(false);
    expect(takeawayPromoBudgetFits(10000, 10000, 0)).toBe(true);
  });

  it('reads the debt status off the payout it went into', () => {
    expect(takeawayDebtStatus(null)).toBe('ACCRUED');
    expect(takeawayDebtStatus({ status: 'PENDING' })).toBe('IN_PAYOUT');
    expect(takeawayDebtStatus({ status: 'PAID' })).toBe('IN_PAYOUT');
    expect(takeawayDebtStatus({ status: 'DISPUTED' })).toBe('IN_PAYOUT');
    expect(takeawayDebtStatus({ status: 'CONFIRMED' })).toBe('REPAID');
  });

  it('puts the promo percent into the welcome text', () => {
    expect(welcomeBonusMessage(10, 'RU').body).toBe(
      'Добрый день! Добро пожаловать в экосистему takeAway. Вот ваш бонус: скидка 10% на заказ в любом заведении.',
    );
    expect(welcomeBonusMessage(15, 'EN').body).toContain('15% off');
  });
});
