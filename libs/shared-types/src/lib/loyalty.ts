/**
 * Loyalty & promo transport types shared between apps/api and the Angular
 * apps. Keep in sync with apps/api/src/app/loyalty/dto/loyalty.dto.ts and
 * apps/api/src/app/promo/dto/promo.dto.ts.
 */

import type { PromoErrorCode } from './order';

export type LoyaltyTier = 'SILVER' | 'GOLD' | 'PLATINUM' | 'SIGNATURE';
export type PointsEntryType = 'EARN' | 'SPEND' | 'EXPIRE' | 'ADJUST';

export type PromoType = 'PERCENT' | 'FIXED' | 'BOGO' | 'POINTS_MULTIPLIER';
export type PromoStatus = 'DRAFT' | 'SCHEDULED' | 'RUNNING' | 'PAUSED' | 'EXPIRED';

export interface LoyaltyEntry {
  id: string;
  type: PointsEntryType;
  amount: number;
  reason: string;
  orderId: string | null;
  createdAt: string;
}

export interface LoyaltyAccount {
  userId: string;
  pointsBalance: number;
  lifetimePoints: number;
  tier: LoyaltyTier;
  nextTier: LoyaltyTier | null;
  pointsToNextTier: number;
  tierProgressPercent: number;
  recent: LoyaltyEntry[];
}

export interface Promo {
  id: string;
  brandId: string;
  code: string;
  label: string;
  type: PromoType;
  value: number;
  minSubtotalCents: number | null;
  maxRedemptions: number;
  perUserLimit: number;
  startsAt: string;
  endsAt: string;
  /** The status in effect now: an active promo past its dates reads SCHEDULED or EXPIRED. */
  status: PromoStatus;
  currency: string;
  redemptionsCount: number;
  /** Set: only for customers with 3+ orders and none for this many days (3, 7 or 14). */
  inactiveDays: number | null;
  /** With `inactiveDays`: only orders at this store count. */
  segmentStoreId: string | null;
}

export interface ValidatePromoInput {
  code: string;
  brandId: string;
  subtotalCents: number;
  /**
   * The store of the cart. A takeAway promo works only at stores selling in
   * its currency; without it the brand's stores are looked at.
   */
  storeId?: string;
}

export interface ValidPromoResult {
  valid: boolean;
  /** English, for logs; show `reasonCode` in the customer's words instead. */
  reason: string | null;
  /** Why the code does not apply; null when it does. Absent from older APIs. */
  reasonCode?: PromoErrorCode | null;
  /** PROMO_MIN_ORDER: the promo's minimum subtotal, in `currency`. */
  minOrderCents?: number;
  currency?: string;
  /** The brand's promo when the code is one; null for a takeAway promo. */
  promo: Promo | null;
  /**
   * Whose code it is: BRAND — the brand's promo code (the brand pays for
   * it); TAKEAWAY — a takeAway promo or welcome bonus (takeAway compensates
   * the venue, loyalty points cannot be added). Null when not valid; absent
   * from older API builds.
   */
  source?: 'BRAND' | 'TAKEAWAY' | null;
  /** The takeAway promo when `source` is TAKEAWAY. */
  takeawayPromo?: { id: string; code: string; name: string; percent: number; isWelcome: boolean } | null;
  discountCents: number;
  pointsMultiplier: number;
}

export interface CreatePromoInput {
  brandId: string;
  code: string;
  label: string;
  type: PromoType;
  value: number;
  minSubtotalCents?: number;
  maxRedemptions?: number;
  perUserLimit?: number;
  startsAt: string;
  endsAt: string;
  status?: PromoStatus;
  currency?: string;
  inactiveDays?: number | null;
  segmentStoreId?: string | null;
}

/** Every field of a promo but its brand and status; status moves through its own endpoint. */
export type UpdatePromoInput = Partial<Omit<CreatePromoInput, 'brandId' | 'status'>>;
