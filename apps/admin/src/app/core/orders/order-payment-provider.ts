import type { PaymentProviderEnum } from '@takeaway/shared-types';

import type { AdminOrderPayment } from './orders.service';

const PROVIDERS: readonly PaymentProviderEnum[] = ['STRIPE', 'AGROPROMBANK', 'AGROPROMBANK_WEB', 'AGROPROMBANK_QR'];

/** Statuses of a payment that took money (or holds it until the kitchen accepts). */
const TOOK_MONEY: readonly string[] = ['SUCCEEDED', 'PARTIALLY_REFUNDED', 'REFUNDED', 'REQUIRES_ACTION'];

/** Statuses of a payment whose money can still be given back. */
const REFUNDABLE: readonly string[] = ['SUCCEEDED', 'PARTIALLY_REFUNDED'];

/**
 * The payment the order's money came with: the newest that took any. A
 * declined card before it, or a QR invoice that lapsed, says nothing about
 * how the customer paid.
 */
export function orderMoneyPayment(payments: readonly AdminOrderPayment[]): AdminOrderPayment | null {
  for (let i = payments.length - 1; i >= 0; i--) {
    const payment = payments[i];
    if (payment && TOOK_MONEY.includes(payment.status)) return payment;
  }
  return null;
}

/** «Мобильный платёж (Агропромбанк)» — the translation key for a provider; null for one this build has no words for. */
export function paymentProviderKey(provider: string): string | null {
  return (PROVIDERS as readonly string[]).includes(provider) ? `admin.orderDetail.providers.${provider}` : null;
}

/**
 * The bank gives a QR payment back only whole: `ReversePayment` takes no
 * amount (docs/agroprombank-payments.md §12.1), so the refund of an order
 * paid by QR is all or nothing.
 */
export function refundsInFullOnly(payments: readonly AdminOrderPayment[]): boolean {
  return payments.some((p) => p.provider === 'AGROPROMBANK_QR' && REFUNDABLE.includes(p.status));
}
