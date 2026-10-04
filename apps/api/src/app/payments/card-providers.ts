import type { PaymentProvider } from '@prisma/client';

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
