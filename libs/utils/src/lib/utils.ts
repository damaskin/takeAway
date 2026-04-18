/**
 * takeAway shared utils — formatters, guards, helpers.
 * Populated in later milestones.
 *
 * Conventions (see 02_CLAUDE_PROMPT.md §7):
 * - Prices are integer cents.
 * - Durations are integer seconds.
 * - Times are UTC ISO strings in transport; timezone conversion is UI-only.
 */

import type { Currency } from '@takeaway/shared-types';

export function formatPrice(cents: number, currency: Currency, locale = 'en'): string {
  return new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);
}

export function secondsToMinutes(seconds: number): number {
  return Math.ceil(seconds / 60);
}
