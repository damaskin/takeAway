import type { OrderCancelMoney } from '@takeaway/shared-types';

/**
 * The sentence about the money of a cancelled or expired order, word for
 * word: the push (`NotificationsService`) ends its text with it, and the
 * customer's order screen repeats it (`common.orderCancelled.money` in
 * `@takeaway/i18n`, the `cancelMoney*` strings of the mobile app). One
 * place, so the two can no longer tell different stories.
 */
export const ORDER_CANCEL_MONEY_TEXT: Readonly<Record<OrderCancelMoney, { readonly ru: string; readonly en: string }>> =
  {
    NOT_CHARGED: { ru: 'Деньги с карты не списывались.', en: 'Your card was not charged.' },
    RELEASED: {
      ru: 'Деньги не списаны, блокировка на карте снята.',
      en: 'You were not charged and the card hold is released.',
    },
    REFUNDED: { ru: 'Деньги вернутся на карту.', en: 'The money is on its way back to your card.' },
    PENDING: {
      ru: 'Блокировка на карте будет снята автоматически.',
      en: 'The card hold will be released automatically.',
    },
  };

const CANCEL_MONEY_VALUES: readonly string[] = ['NOT_CHARGED', 'RELEASED', 'REFUNDED', 'PENDING'];

/** A `cancelMoney` value this build knows; null for anything else (a newer API, or none). */
export function readCancelMoney(value: string | null | undefined): OrderCancelMoney | null {
  return value && CANCEL_MONEY_VALUES.includes(value) ? (value as OrderCancelMoney) : null;
}
