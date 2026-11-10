import type { Currency, OrderStatus, PayoutStatus } from '@prisma/client';

/**
 * Test-only: a `TakeawayPromoRedemption` as `countedRedemptions` reads it
 * (COUNTED_REDEMPTION_SELECT), with the order and payout it hangs on.
 */
export interface RedemptionFixture {
  id?: string;
  orderId?: string;
  orderCode?: string;
  promoId?: string;
  promoName?: string;
  userId?: string;
  brandId?: string;
  brandName?: string;
  storeId?: string;
  storeName?: string;
  currency?: Currency;
  percent?: number;
  menuTotalCents?: number;
  discountCents?: number;
  orderStatus?: OrderStatus;
  acceptedAt?: Date | null;
  /** Captured payments of the order (createdAt), in its currency. */
  capturedAt?: Date[];
  payout?: { id: string; status: PayoutStatus; paidAt: Date | null } | null;
}

let next = 1;

export function redemptionRow(f: RedemptionFixture = {}) {
  const n = next++;
  const currency = f.currency ?? 'MDL';
  return {
    id: f.id ?? `r-${n}`,
    orderId: f.orderId ?? `order-${n}`,
    promoId: f.promoId ?? 'tp-1',
    userId: f.userId ?? `user-${n}`,
    brandId: f.brandId ?? 'brand-1',
    storeId: f.storeId ?? 'store-1',
    currency,
    code: 'AUTUMN10',
    percent: f.percent ?? 10,
    menuTotalCents: f.menuTotalCents ?? 10_000,
    discountCents: f.discountCents ?? 1_000,
    payoutId: f.payout?.id ?? null,
    promo: { name: f.promoName ?? 'Осенняя акция' },
    payout: f.payout ? { status: f.payout.status, paidAt: f.payout.paidAt } : null,
    order: {
      orderCode: f.orderCode ?? String(1000 + n),
      status: f.orderStatus ?? 'PICKED_UP',
      acceptedAt: f.acceptedAt === undefined ? new Date('2026-11-10T09:00:00Z') : f.acceptedAt,
      currency,
      store: { name: f.storeName ?? 'Центр', brand: { name: f.brandName ?? 'NoName Coffee' } },
      payments: (f.capturedAt ?? []).map((createdAt) => ({ createdAt, currency })),
    },
  };
}
