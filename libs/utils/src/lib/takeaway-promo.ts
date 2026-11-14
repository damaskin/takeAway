import type { TakeawayDebtStatus } from '@takeaway/shared-types';

/**
 * The money rules of takeAway's own promos («Акции takeAway»,
 * docs/takeaway-promos.md): a percent discount at every venue that takeAway
 * pays for. The guest pays P − D, takeAway owes the venue D and settles it
 * in the next payout, and the commission is taken on the full menu price P —
 * so a promo order pays the venue exactly what a regular one would.
 *
 * Integer minor units (cents / kopecks / bani) throughout: a float turns
 * 15.55 × 10 % into 1.55 instead of 1.56.
 */

/** Smallest and largest percent of a takeAway promo. 100 % would leave nothing to pay by card. */
export const TAKEAWAY_PROMO_MIN_PERCENT = 1;
export const TAKEAWAY_PROMO_MAX_PERCENT = 99;

/** How long a welcome bonus lasts after sign-up. */
export const WELCOME_BONUS_DAYS = 7;

export function isValidTakeawayPromoPercent(percent: number): boolean {
  return Number.isInteger(percent) && percent >= TAKEAWAY_PROMO_MIN_PERCENT && percent <= TAKEAWAY_PROMO_MAX_PERCENT;
}

/**
 * D = P × s / 100, to the cent, half up: 15.55 at 10 % is 1.56, so the guest
 * pays 13.99. `menuTotalCents` is the order at menu prices, variants and
 * add-ons included, before any other discount.
 */
export function takeawayPromoDiscountCents(menuTotalCents: number, percent: number): number {
  if (!Number.isSafeInteger(menuTotalCents) || menuTotalCents < 0) {
    throw new RangeError(`menuTotalCents must be a non-negative integer, got ${menuTotalCents}`);
  }
  if (!isValidTakeawayPromoPercent(percent)) {
    throw new RangeError(
      `percent must be an integer within ${TAKEAWAY_PROMO_MIN_PERCENT}..${TAKEAWAY_PROMO_MAX_PERCENT}, got ${percent}`,
    );
  }
  return Math.floor((menuTotalCents * percent + 50) / 100);
}

/** What the guest pays (P − D) and what takeAway owes the venue (D) for one order. */
export function takeawayPromoSplit(
  menuTotalCents: number,
  percent: number,
): { discountCents: number; paidByGuestCents: number; compensationCents: number } {
  const discountCents = takeawayPromoDiscountCents(menuTotalCents, percent);
  return { discountCents, paidByGuestCents: menuTotalCents - discountCents, compensationCents: discountCents };
}

/**
 * Whether the budget can take one more discount. A discount larger than what
 * is left is refused outright (the order gets no promo) and the promo is
 * exhausted from then on — it never goes partly.
 */
export function takeawayPromoBudgetFits(budgetCents: number, spentCents: number, discountCents: number): boolean {
  return spentCents + discountCents <= budgetCents;
}

/**
 * Where a promo order's compensation stands: owed, part of a fixed settlement,
 * or settled — once the brand confirmed the settlement (docs/settlements.md:
 * only a confirmed settlement closes the balance).
 */
export function takeawayDebtStatus(
  payout: { status: 'PENDING' | 'PAID' | 'CONFIRMED' | 'DISPUTED' } | null | undefined,
): TakeawayDebtStatus {
  if (!payout) return 'ACCRUED';
  return payout.status === 'CONFIRMED' ? 'REPAID' : 'IN_PAYOUT';
}

/**
 * The welcome push and inbox text. The percent comes from the promo, never
 * from the code. Russian unless the customer chose English.
 */
export function welcomeBonusMessage(percent: number, locale: 'RU' | 'EN' | string): { title: string; body: string } {
  if (locale === 'EN') {
    return {
      title: 'Your welcome bonus',
      body: `Hello! Welcome to the takeAway ecosystem. Here is your bonus: ${percent}% off an order at any venue.`,
    };
  }
  return {
    title: 'Приветственный бонус',
    body: `Добрый день! Добро пожаловать в экосистему takeAway. Вот ваш бонус: скидка ${percent}% на заказ в любом заведении.`,
  };
}
