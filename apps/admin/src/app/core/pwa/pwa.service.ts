import { Injectable, signal } from '@angular/core';

/** Chromium's install prompt event; not in the DOM typings. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * The admin as an installable app.
 *
 * Registers the service worker (public/sw.js) and keeps Chromium's install
 * prompt so the sidebar can offer "Install app" at a moment the user picks,
 * rather than the browser's own mini-infobar. Safari has no such event —
 * there the user installs through Share → Add to Home Screen and the
 * button simply never shows.
 *
 * Every step fails silently: a private window, an insecure origin or
 * blocked site data has no service worker, and none of that should get in
 * the way of someone taking orders.
 */
@Injectable({ providedIn: 'root' })
export class PwaService {
  private deferred: BeforeInstallPromptEvent | null = null;

  /** True while the browser would install the app if asked. */
  readonly canInstall = signal(false);

  init(): void {
    if (typeof window === 'undefined') return;

    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault();
      this.deferred = event as BeforeInstallPromptEvent;
      this.canInstall.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.deferred = null;
      this.canInstall.set(false);
    });

    if (!('serviceWorker' in navigator)) return;
    // After load, so registration never competes with the first paint.
    const register = (): void => {
      void navigator.serviceWorker.register('/sw.js').catch(() => undefined);
    };
    if (document.readyState === 'complete') register();
    else window.addEventListener('load', register, { once: true });
  }

  async install(): Promise<void> {
    const prompt = this.deferred;
    if (!prompt) return;
    // A prompt can be shown once; a dismissed one waits for the next event.
    this.deferred = null;
    this.canInstall.set(false);
    await prompt.prompt().catch(() => undefined);
  }
}
