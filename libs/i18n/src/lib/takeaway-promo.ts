import type { TranslateService } from '@ngx-translate/core';

import type { AppLocale } from './i18n.types';

/**
 * A takeAway promo as the customer reads it on web and in the Mini App
 * (docs/takeaway-promos.md §5): «Приветственный бонус −10%» for the welcome
 * bonus, «Акция takeAway −10%» for any other.
 */
export function takeawayPromoLabel(
  promo: { percent: number; isWelcome?: boolean },
  translate: TranslateService,
): string {
  const key = promo.isWelcome ? 'common.takeawayPromo.welcome' : 'common.takeawayPromo.promo';
  return translate.instant(key, { percent: promo.percent });
}

/**
 * «На заказ в любом заведении · до 17 ноября» — the bonus's last day with the
 * month spelled out, on the customer's own calendar: the bonus is theirs, not
 * a store's, so no store zone applies.
 */
export function customerBonusTerms(bonus: { expiresAt: string }, translate: TranslateService, lang: AppLocale): string {
  const expires = new Date(bonus.expiresAt);
  const date = Number.isNaN(expires.getTime())
    ? ''
    : new Intl.DateTimeFormat(lang === 'en' ? 'en' : 'ru', { day: 'numeric', month: 'long' }).format(expires);
  return translate.instant('common.takeawayPromo.anyStoreUntil', { date });
}
