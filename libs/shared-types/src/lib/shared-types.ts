/**
 * takeAway shared types — source of truth for cross-app DTOs.
 * Reference: 01_TECHNICAL_SPEC.md §5 Data model.
 * Populated in later milestones (M1+).
 */

// RUP — Transnistrian rouble. No ISO 4217 code exists for it; the ПРБ
// directory used by Agroprombank numbers it `000`.
export type Currency = 'USD' | 'EUR' | 'GBP' | 'AED' | 'THB' | 'IDR' | 'MDL' | 'RUP';

export type Locale = 'en' | 'ru';

export type OrderStatus =
  | 'CREATED'
  | 'PAID'
  | 'ACCEPTED'
  | 'IN_PROGRESS'
  | 'READY'
  | 'PICKED_UP'
  | 'CANCELLED'
  | 'EXPIRED';

export type PickupMode = 'ASAP' | 'SCHEDULED';

export type FulfillmentType = 'PICKUP' | 'DINE_IN' | 'DELIVERY';

export type PickupPointType = 'COUNTER' | 'LOCKER' | 'SHELF';
