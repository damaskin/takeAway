/**
 * Loyalty & promo transport types shared between apps/api and the Angular
 * apps. Keep in sync with apps/api/src/app/loyalty/dto/loyalty.dto.ts and
 * apps/api/src/app/promo/dto/promo.dto.ts.
 */

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
  status: PromoStatus;
  currency: string;
  redemptionsCount: number;
}

export interface ValidatePromoInput {
  code: string;
  brandId: string;
  subtotalCents: number;
}

export interface ValidPromoResult {
  valid: boolean;
  reason: string | null;
  promo: Promo | null;
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
}
