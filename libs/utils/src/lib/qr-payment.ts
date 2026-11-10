/**
 * Agroprombank «Мобильный платёж» on the customer's side
 * (docs/agroprombank-payments.md §12): which way checkout pays, and when the
 * QR screen gives up waiting. Pure, so the web, the Mini App and their tests
 * agree.
 */

import type { AgroprombankQrPaymentDto } from '@takeaway/shared-types';

/** How the customer pays at checkout: by card (bound or on the bank's page), or by QR in the bank's app. */
export type CheckoutPaymentMethod = 'CARD' | 'QR';

/** How often the QR screen asks whether the invoice is paid (§12.3). */
export const QR_PAYMENT_POLL_MS = 3_000;

/**
 * After the invoice lapses the API may still say PENDING for a while — the
 * reconciliation closes it two minutes past its lifetime, and money paid in
 * the last second lands then too. The screen keeps asking this long.
 */
export const QR_PAYMENT_GRACE_MS = 3 * 60_000;

/**
 * A store can be paid by QR: its currency is one the QR payment takes
 * (`qrPaymentCurrencies` of `GET /config/features`; absent or empty — none).
 */
export function qrPaymentOffered(
  currency: string | null | undefined,
  currencies: readonly string[] | null | undefined,
): boolean {
  return !!currency && Array.isArray(currencies) && currencies.includes(currency);
}

/**
 * The way checkout pays: with both on, the customer's last choice on this
 * device, else the card; with one on, that one; with neither, none.
 */
export function checkoutPaymentMethod(
  available: { card: boolean; qr: boolean },
  remembered: string | null | undefined,
): CheckoutPaymentMethod | null {
  if (available.card && available.qr) return remembered === 'QR' ? 'QR' : 'CARD';
  if (available.qr) return 'QR';
  return available.card ? 'CARD' : null;
}

/** A remembered choice this build knows; null for anything else. */
export function readCheckoutPaymentMethod(value: string | null | undefined): CheckoutPaymentMethod | null {
  return value === 'CARD' || value === 'QR' ? value : null;
}

/**
 * Worth asking the API about the invoice again: it waits to be paid, or
 * lapsed so recently that a payment made in its last second may still land.
 */
export function qrPaymentWorthPolling(payment: Pick<AgroprombankQrPaymentDto, 'status' | 'qr'>, now: number): boolean {
  if (payment.status !== 'PENDING') return false;
  const at = payment.qr ? Date.parse(payment.qr.expiresAt) : NaN;
  return !Number.isFinite(at) || now < at + QR_PAYMENT_GRACE_MS;
}

/** Milliseconds until the invoice stops being offered; never negative, 0 for a time that cannot be read. */
export function qrTimeLeftMs(expiresAt: string | null | undefined, now: number): number {
  const at = expiresAt ? Date.parse(expiresAt) : NaN;
  return Number.isFinite(at) ? Math.max(0, at - now) : 0;
}

/**
 * The customer looks at the QR code on a phone (or tablet), so they cannot
 * scan it with the same device: without a link into the bank's app the
 * screen says to scan it from another one.
 */
export function looksLikePhone(userAgent: string | null | undefined): boolean {
  return !!userAgent && /Android|iPhone|iPad|iPod|Mobile/i.test(userAgent);
}
