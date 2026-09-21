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

/**
 * Builds a universal directions URL for the "Build route" button.
 *
 * The Google Maps `dir` URL is honored across platforms: it opens the
 * Google Maps app on Android, Google Maps (or a web→Apple Maps prompt) on
 * iOS, and the browser on desktop — no platform sniffing, no API key. The
 * route itself is computed by whichever maps app the customer uses.
 */
export function buildDirectionsUrl(dest: { lat: number; lng: number }): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${dest.lat},${dest.lng}`;
}
