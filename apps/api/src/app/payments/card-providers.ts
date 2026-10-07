import type { Payment, PaymentProvider } from '@prisma/client';

/**
 * Providers that take a card through Agroprombank: the tokenized
 * («Рекуррентные платежи») flow and the hosted «Web-платёж» page.
 *
 * Both park a preauthorization in `REQUIRES_ACTION` until the kitchen accepts
 * the order, so every rule about holds — the board showing an order only once
 * it is paid for, capture on accept, release on cancel or expiry — applies to
 * either. Which bank call that takes is decided per payment row.
 */
export const CARD_PROVIDERS = ['AGROPROMBANK', 'AGROPROMBANK_WEB'] as const satisfies readonly PaymentProvider[];

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
