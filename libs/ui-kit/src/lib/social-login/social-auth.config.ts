import { InjectionToken } from '@angular/core';

export interface SocialAuthConfig {
  /**
   * Google OAuth **web** client id, e.g. `123-abc.apps.googleusercontent.com`.
   * Public value — the server checks it back as the token's `aud`, so it has
   * to be listed in the API's `GOOGLE_OAUTH_CLIENT_IDS`. Blank hides the
   * button.
   */
  googleClientId: string;

  /**
   * Apple **Services ID** (not the app bundle id), e.g. `com.takeaway.web`.
   * Must be listed in the API's `APPLE_OAUTH_CLIENT_IDS`. Blank hides the
   * button.
   */
  appleClientId: string;

  /**
   * Return URL registered against the Services ID in Apple's developer
   * console. Apple rejects the popup outright if this does not match one of
   * the registered URLs character for character. Empty means "use the
   * current origin", which is right for a single-domain deployment.
   */
  appleRedirectUri: string;
}

export const SOCIAL_AUTH_CONFIG = new InjectionToken<SocialAuthConfig>('SOCIAL_AUTH_CONFIG');

export const DEFAULT_SOCIAL_AUTH_CONFIG: SocialAuthConfig = {
  googleClientId: '',
  appleClientId: '',
  appleRedirectUri: '',
};

/**
 * Reads the client ids off window globals, the same way the Telegram bot
 * username is wired: staging and prod swap credentials by editing
 * `index.html`, without rebuilding the SPA. All three values are public —
 * nothing here is a secret.
 */
export function resolveSocialAuthConfig(): SocialAuthConfig {
  if (typeof globalThis === 'undefined') return DEFAULT_SOCIAL_AUTH_CONFIG;
  const g = globalThis as {
    __GOOGLE_CLIENT_ID?: string;
    __APPLE_CLIENT_ID?: string;
    __APPLE_REDIRECT_URI?: string;
  };
  return {
    googleClientId: g.__GOOGLE_CLIENT_ID || DEFAULT_SOCIAL_AUTH_CONFIG.googleClientId,
    appleClientId: g.__APPLE_CLIENT_ID || DEFAULT_SOCIAL_AUTH_CONFIG.appleClientId,
    appleRedirectUri: g.__APPLE_REDIRECT_URI || DEFAULT_SOCIAL_AUTH_CONFIG.appleRedirectUri,
  };
}

/**
 * What a social button hands back to the page: the provider's ID token,
 * plus a display name on the one occasion Apple sends it.
 */
export interface SocialAuthResult {
  idToken: string;
  name?: string;
}

const loading = new Map<string, Promise<void>>();

/**
 * Loads a third-party SDK once per page and resolves when it is ready.
 *
 * Both Google and Apple ship their SDK as a plain script that registers a
 * global. Two buttons on the same screen must not inject the tag twice, and
 * a component that re-mounts (Angular route change) must not re-download —
 * so the in-flight promise is cached by URL.
 */
export function loadExternalScript(src: string): Promise<void> {
  const existing = loading.get(src);
  if (existing) return existing;

  const promise = new Promise<void>((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('No document — cannot load an external script'));
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Drop the cache entry so a later retry can try the network again.
      loading.delete(src);
      reject(new Error(`Failed to load ${src}`));
    };
    document.head.appendChild(script);
  });

  loading.set(src, promise);
  return promise;
}
