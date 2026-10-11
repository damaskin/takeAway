import { InjectionToken } from '@angular/core';

import { type SiteLinks, appStoreUrl, googlePlayUrl } from '../../core/config/site-links';

/** Which store's app the device runs; null for a computer or anything else. */
export type InstallPlatform = 'ios' | 'android' | null;

/**
 * The phone behind a user agent. iPadOS asks for the desktop site and calls
 * itself a Mac, so a "Mac" with a touch screen is taken for an iPad.
 */
export function installPlatform(userAgent: string, maxTouchPoints = 0): InstallPlatform {
  if (/android/i.test(userAgent)) return 'android';
  if (/iphone|ipad|ipod/i.test(userAgent)) return 'ios';
  if (/macintosh/i.test(userAgent) && maxTouchPoints > 1) return 'ios';
  return null;
}

/** The store page a phone is sent to, or null when there is none for it (yet). */
export function storeFor(platform: InstallPlatform, links?: SiteLinks): string | null {
  if (platform === 'ios') return appStoreUrl(links);
  if (platform === 'android') return googlePlayUrl(links);
  return null;
}

/** What `/app` reads about the device, and how it leaves for the store. */
export interface InstallDevice {
  userAgent: string;
  maxTouchPoints: number;
  /** Replaces the page, so Back from the store does not land on the redirect again. */
  open(url: string): void;
}

export const INSTALL_DEVICE = new InjectionToken<InstallDevice>('INSTALL_DEVICE', {
  providedIn: 'root',
  factory: () => ({
    userAgent: globalThis.navigator?.userAgent ?? '',
    maxTouchPoints: globalThis.navigator?.maxTouchPoints ?? 0,
    open: (url: string) => globalThis.location?.replace(url),
  }),
});
