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

export const GIFT_CARD_CURRENCIES = ['USD', 'EUR', 'GBP', 'AED', 'THB', 'IDR', 'MDL', 'RUP'] as const;

export type GiftCardCurrency = (typeof GIFT_CARD_CURRENCIES)[number];
