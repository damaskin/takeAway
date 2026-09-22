import type { BrandModerationStatus } from '@prisma/client';

import { isLocalTimeZone } from '../../common/time/time-zone';

/**
 * What a store needs before it can take orders.
 *
 * Stores used to go live the moment they were created — at 0,0, on UTC,
 * with an empty menu. They now start CLOSED, and opening one is refused
 * until the required checks pass; the admin shows the same list so the
 * owner knows what is left to do.
 */
export type ReadinessCheck = 'coordinates' | 'timezone' | 'hours' | 'menu' | 'brandApproved';

export interface ReadinessItem {
  check: ReadinessCheck;
  ok: boolean;
  /** Required checks gate opening; the others are shown for context. */
  required: boolean;
}

export interface StoreReadiness {
  /** Every required check passes — the store may be opened. */
  ready: boolean;
  items: ReadinessItem[];
}

export interface ReadinessFacts {
  latitude: number;
  longitude: number;
  timezone: string;
  workingHours: readonly { isClosed: boolean }[];
  /** Visible products in visible categories of the store's brand. */
  visibleProducts: number;
  brandStatus: BrandModerationStatus | null;
}

export function storeReadiness(facts: ReadinessFacts): StoreReadiness {
  const items: ReadinessItem[] = [
    { check: 'coordinates', ok: hasCoordinates(facts.latitude, facts.longitude), required: true },
    { check: 'timezone', ok: isLocalTimeZone(facts.timezone), required: true },
    // No rows reads as "open around the clock" to the kitchen, but nobody
    // decided that; 24/7 is saved as seven explicit 00:00–24:00 rows.
    { check: 'hours', ok: facts.workingHours.some((h) => !h.isClosed), required: true },
    { check: 'menu', ok: facts.visibleProducts > 0, required: true },
  ];
  // Moderation is its own gate — an unapproved brand takes no orders
  // whatever its stores say — so opening ahead of approval is allowed and
  // the store simply goes live once the brand is approved.
  if (facts.brandStatus) {
    items.push({ check: 'brandApproved', ok: facts.brandStatus === 'APPROVED', required: false });
  }
  return { ready: items.every((i) => i.ok || !i.required), items };
}

/** The required checks that fail, in display order. */
export function missingChecks(readiness: StoreReadiness): ReadinessCheck[] {
  return readiness.items.filter((i) => i.required && !i.ok).map((i) => i.check);
}

/** 0,0 is where POS imports and blank forms put a store, not a café. */
function hasCoordinates(latitude: number, longitude: number): boolean {
  return Number.isFinite(latitude) && Number.isFinite(longitude) && !(latitude === 0 && longitude === 0);
}
