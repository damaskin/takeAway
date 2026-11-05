/** One issued gift card, as `/admin/gift-cards` returns it. */
export interface GiftCardRow {
  id: string;
  code: string;
  brandId: string;
  initialAmountCents: number;
  balanceCents: number;
  currency: string;
  status: 'ACTIVE' | 'REDEEMED' | 'EXPIRED' | 'CANCELLED';
  recipientEmail: string | null;
  recipientName: string | null;
  message: string | null;
  expiresAt: string | null;
  createdAt: string;
}

/**
 * New cards are issued in Transnistrian rubles only; the API refuses any
 * other currency. Older cards in other currencies still list with theirs.
 */
export const GIFT_CARD_CURRENCY = 'RUP';
