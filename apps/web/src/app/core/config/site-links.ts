import { InjectionToken } from '@angular/core';

/**
 * Where the site points outside itself: takeAway's accounts in the social
 * networks (icons in the footer) and the app in the stores (`/app`, the
 * store buttons, the redirect by phone).
 *
 * Public values, the same in every environment, so they live here rather
 * than in the deploy's env like the per-environment ones in index.html.
 * An empty value hides what it feeds — an icon, a button, a redirect — so
 * nothing on the site leads nowhere. How to fill them:
 * docs/site-links.md.
 */
export interface SiteLinks {
  /** Full profile URLs, e.g. `https://instagram.com/takeaway.md`. */
  social: {
    instagram: string;
    telegram: string;
    tiktok: string;
    facebook: string;
    vk: string;
  };
  apps: {
    /**
     * The App Store id: the digits after `id` in the listing's address
     * (`https://apps.apple.com/app/id1234567890`). Empty until the iPhone
     * app is public — then also add the Smart App Banner to index.html
     * (`<meta name="apple-itunes-app" content="app-id=…">`); a test holds
     * the two together.
     */
    appStoreId: string;
    /** The Android application id — apps/mobile/android/app/build.gradle.kts. */
    googlePlayId: string;
  };
}

export const SITE_LINKS: SiteLinks = {
  social: {
    instagram: '',
    telegram: '',
    tiktok: '',
    facebook: '',
    vk: '',
  },
  apps: {
    appStoreId: '',
    googlePlayId: 'md.takeaway.app',
  },
};

/** {@link SITE_LINKS} for the components that show them; tests provide their own. */
export const SITE_LINKS_CONFIG = new InjectionToken<SiteLinks>('SITE_LINKS_CONFIG', {
  providedIn: 'root',
  factory: () => SITE_LINKS,
});

export type SocialNetwork = keyof SiteLinks['social'];

/** The App Store listing, or null while the id is unknown. */
export function appStoreUrl(links: SiteLinks = SITE_LINKS): string | null {
  const id = links.apps.appStoreId.trim().replace(/^id/i, '');
  return /^\d+$/.test(id) ? `https://apps.apple.com/app/id${id}` : null;
}

/** The Google Play listing, or null without an application id. */
export function googlePlayUrl(links: SiteLinks = SITE_LINKS): string | null {
  const id = links.apps.googlePlayId.trim();
  return id ? `https://play.google.com/store/apps/details?id=${encodeURIComponent(id)}` : null;
}

/** The social profiles that have an address, in footer order. */
export function socialProfiles(links: SiteLinks = SITE_LINKS): { network: SocialNetwork; url: string }[] {
  const order: SocialNetwork[] = ['instagram', 'telegram', 'tiktok', 'facebook', 'vk'];
  return order.flatMap((network) => {
    const url = links.social[network].trim();
    return /^https:\/\//.test(url) ? [{ network, url }] : [];
  });
}
