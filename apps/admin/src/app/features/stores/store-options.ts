import { type ValidatorFn, Validators } from '@angular/forms';
import {
  ACCEPT_WINDOW_MAX_MINUTES,
  ACCEPT_WINDOW_MIN_MINUTES,
  DEFAULT_ACCEPT_WINDOW_MINUTES,
} from '@takeaway/shared-types';
import type { LatLng } from '@takeaway/ui-kit';
import { isUnsetTimeZone } from '@takeaway/utils';

/** Currencies a store can take, the launch markets' first. Mirrors the API's Currency enum. */
export const STORE_CURRENCIES = ['MDL', 'RUP', 'EUR', 'USD', 'GBP', 'AED', 'THB', 'IDR'] as const;

/** Mirrors STORE_SLUG_PATTERN on the API: it becomes the /stores/<slug> URL. */
export const STORE_SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Where the map opens when a store has no location yet. */
export const CHISINAU: LatLng = { lat: 47.0105, lng: 28.8638 };

/**
 * A store that takes (or may take) orders while still on the UTC
 * placeholder zone: its working hours are read two or three hours off.
 * Closed stores are left to the readiness checklist.
 */
export function storeNeedsTimeZone(store: { status: string; timezone?: string | null }): boolean {
  return store.status !== 'CLOSED' && isUnsetTimeZone(store.timezone);
}

/** Moldovan and Transnistrian brands are almost always in MD. */
export function defaultCountryFor(currency: string | null | undefined): string {
  return currency === 'MDL' || currency === 'RUP' ? 'MD' : '';
}

/** «Время для принятия заказа» (`baseEtaSeconds`): whole minutes from 1 to 60, as the API takes it. */
export const ACCEPT_MINUTES_VALIDATORS: ValidatorFn[] = [
  Validators.required,
  Validators.min(ACCEPT_WINDOW_MIN_MINUTES),
  Validators.max(ACCEPT_WINDOW_MAX_MINUTES),
  Validators.pattern(/^\d+$/),
];

/**
 * The accept time a store shows in its form, in whole minutes: an older
 * store saved with less than a minute (0 was allowed) shows the default the
 * API counts it as, so saving the form does not trip over the 1–60 rule.
 */
export function acceptWindowMinutes(seconds: number | null | undefined): number {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds) || seconds < 60) {
    return DEFAULT_ACCEPT_WINDOW_MINUTES;
  }
  return Math.min(ACCEPT_WINDOW_MAX_MINUTES, Math.round(seconds / 60));
}
