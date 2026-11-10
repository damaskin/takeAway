import type { OrderCancelMoney, Payment, PaymentProvider } from '@prisma/client';

/**
 * Providers that take a card through Agroprombank: the tokenized
 * («Рекуррентные платежи») flow, the hosted «Web-платёж» page and the QR
 * invoice paid in the bank's app («Мобильный платёж»).
 *
 * All three park the money in `REQUIRES_ACTION` until the kitchen accepts the
 * order — a preauthorization, or, for QR, money already taken — so every rule
 * about holds — the board showing an order only once it is paid for, capture
 * (for QR: settling with no bank call) on accept, release (for QR: a
 * reversal) on cancel or expiry — applies to each. Which bank call that takes
 * is decided per payment row.
 */
export const CARD_PROVIDERS = [
  'AGROPROMBANK',
  'AGROPROMBANK_WEB',
  'AGROPROMBANK_QR',
] as const satisfies readonly PaymentProvider[];

export type CardProvider = (typeof CARD_PROVIDERS)[number];

export function isCardProvider(provider: PaymentProvider): provider is CardProvider {
  return (CARD_PROVIDERS as readonly PaymentProvider[]).includes(provider);
}

/**
 * A bound-card charge put off until the store accepts the order
 * (`AGROPROMBANK_HOLD_UNTIL_ACCEPTED=false`): the row sits in `REQUIRES_ACTION`
 * like a hold, but nothing was sent to the bank and it has no `invoiceId`
 * until the accept charges the card. Calling one off is bookkeeping only.
 */
export function isDeferredCharge(payment: Pick<Payment, 'rawJson'>): boolean {
  const raw = payment.rawJson;
  return (
    !!raw && typeof raw === 'object' && !Array.isArray(raw) && (raw as Record<string, unknown>)['deferred'] === true
  );
}

/**
 * Where releasing an order's hold (PaymentHoldsService.releaseForOrder) left
 * the customer's money, for `Order.cancelMoney` and the push: a charge put
 * off until the accept and called off never touched the card
 * (`NOT_CHARGED`); a hold that came off is `RELEASED`; a paid QR invoice was
 * money taken, so giving it back is `REFUNDED`; one the bank did not let go
 * of yet is `PENDING` — the reconciliation cron keeps trying. Null when the
 * order had no hold to release.
 */
export function releaseOutcome(
  released: Pick<Payment, 'rawJson' | 'provider'> | null,
  hadHold: boolean,
): Extract<OrderCancelMoney, 'NOT_CHARGED' | 'RELEASED' | 'REFUNDED' | 'PENDING'> | null {
  if (released) {
    if (isDeferredCharge(released)) return 'NOT_CHARGED';
    return released.provider === 'AGROPROMBANK_QR' ? 'REFUNDED' : 'RELEASED';
  }
  return hadHold ? 'PENDING' : null;
}
