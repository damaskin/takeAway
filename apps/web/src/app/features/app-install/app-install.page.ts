import { Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Title } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { SITE_LINKS_CONFIG, appStoreUrl, googlePlayUrl } from '../../core/config/site-links';
import { INSTALL_DEVICE, installPlatform, storeFor } from './install-platform';

/**
 * `takeaway.md/app` — one link to the app for posters, table tents and
 * messages. A phone goes straight to its store (iPhone → App Store, Android
 * → Google Play); a computer, or a phone whose store has no listing yet,
 * gets this page: the store buttons there are, and a QR code of this very
 * address to open it on a phone.
 *
 * The site has no server rendering, so the redirect happens as the page
 * loads, replacing it — Back from the store does not bounce here again.
 * The store addresses come from `SITE_LINKS.apps`; a store without one has
 * no button and no redirect.
 */
@Component({
  selector: 'app-install-page',
  standalone: true,
  imports: [RouterLink, TranslatePipe],
  template: `
    <section class="install">
      <div class="install-card">
        <h1>{{ 'web.appInstall.title' | translate }}</h1>
        @if (redirecting(); as store) {
          <p class="install-lead" role="status">{{ 'web.appInstall.redirecting' | translate: { store } }}</p>
        } @else {
          <p class="install-lead">{{ 'web.appInstall.subtitle' | translate }}</p>
        }

        @if (appStore || googlePlay) {
          <div class="install-stores">
            @if (appStore; as url) {
              <a class="install-store" [href]="url" data-store="app-store">
                <svg width="18" height="21" viewBox="0 0 16 19" fill="currentColor" aria-hidden="true">
                  <path
                    d="M13.24 10.02c-.02-2.2 1.8-3.26 1.88-3.31-1.02-1.5-2.62-1.7-3.19-1.72-1.36-.14-2.65.8-3.34.8-.69 0-1.75-.78-2.87-.76-1.48.02-2.84.86-3.6 2.18-1.53 2.66-.39 6.6 1.1 8.76.73 1.06 1.6 2.25 2.74 2.2 1.1-.04 1.52-.71 2.85-.71s1.7.71 2.87.69c1.18-.02 1.93-1.08 2.65-2.14.84-1.23 1.18-2.42 1.2-2.48-.03-.01-2.3-.88-2.32-3.5zM11.05 3.5c.6-.74 1.02-1.75.9-2.77-.87.04-1.94.59-2.57 1.32-.56.65-1.06 1.7-.93 2.7.98.07 1.98-.5 2.6-1.25z"
                  />
                </svg>
                {{ 'web.appInstall.appStore' | translate }}
              </a>
            }
            @if (googlePlay; as url) {
              <a class="install-store" [href]="url" data-store="google-play">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                  <path d="M5 3.5v17a1 1 0 0 0 1.5.87l14.7-8.5a1 1 0 0 0 0-1.74L6.5 2.63A1 1 0 0 0 5 3.5Z" />
                </svg>
                {{ 'web.appInstall.googlePlay' | translate }}
              </a>
            }
          </div>
        }

        @if (platform === 'ios' && !appStore) {
          <p class="install-note" data-testid="no-ios">{{ 'web.appInstall.noIos' | translate }}</p>
        }

        @if (platform === null) {
          <figure class="install-qr">
            <img src="/app-qr.svg" width="168" height="168" [alt]="'web.appInstall.qrAlt' | translate" />
            <figcaption>
              <strong>{{ 'web.appInstall.qrTitle' | translate }}</strong>
              <span>{{ 'web.appInstall.qrHint' | translate }}</span>
            </figcaption>
          </figure>
        }

        <a routerLink="/menu" class="install-web">{{ 'web.appInstall.orWeb' | translate }} →</a>
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .install {
        background: var(--color-cream);
        padding: clamp(32px, 6vw, 72px) clamp(16px, 5vw, 24px);
      }
      .install-card {
        max-width: 560px;
        margin: 0 auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 20px;
        text-align: center;
        background: var(--color-foam);
        border: 1px solid var(--color-border-light);
        border-radius: var(--radius-card);
        padding: clamp(24px, 5vw, 40px);
        font-family: var(--font-sans);
      }
      h1 {
        margin: 0;
        font-family: var(--font-display);
        font-size: clamp(28px, 5vw, 36px);
        color: var(--color-espresso);
      }
      .install-lead,
      .install-note {
        margin: 0;
        font-size: 15px;
        line-height: 1.6;
        color: var(--color-text-secondary);
      }
      .install-stores {
        display: flex;
        flex-wrap: wrap;
        justify-content: center;
        gap: 12px;
      }
      .install-store {
        display: inline-flex;
        align-items: center;
        gap: 10px;
        height: 52px;
        padding: 0 22px;
        border-radius: 14px;
        background: var(--color-espresso);
        color: var(--color-cream);
        font-size: 15px;
        font-weight: 600;
      }
      .install-qr {
        margin: 0;
        display: flex;
        align-items: center;
        gap: 16px;
        text-align: left;
      }
      .install-qr img {
        border-radius: 12px;
        border: 1px solid var(--color-border);
        background: #fff;
        padding: 8px;
      }
      .install-qr figcaption {
        display: flex;
        flex-direction: column;
        gap: 6px;
        font-size: 14px;
        color: var(--color-text-secondary);
        max-width: 220px;
      }
      .install-qr strong {
        color: var(--color-text-primary);
      }
      .install-web {
        font-size: 15px;
        font-weight: 600;
        color: var(--color-caramel);
      }
      @media (max-width: 480px) {
        .install-qr {
          flex-direction: column;
          text-align: center;
        }
      }
    `,
  ],
})
export class AppInstallPage {
  private readonly device = inject(INSTALL_DEVICE);
  private readonly links = inject(SITE_LINKS_CONFIG);

  readonly appStore = appStoreUrl(this.links);
  readonly googlePlay = googlePlayUrl(this.links);
  readonly platform = installPlatform(this.device.userAgent, this.device.maxTouchPoints);
  /** The store the phone is on its way to, while the redirect runs. */
  readonly redirecting = signal<'App Store' | 'Google Play' | null>(null);

  constructor() {
    const target = storeFor(this.platform, this.links);
    if (target) {
      this.redirecting.set(this.platform === 'ios' ? 'App Store' : 'Google Play');
      this.device.open(target);
    }

    // The tab is named after the page, in the language on screen, and gets
    // the site's own name back on the way out.
    const title = inject(Title);
    const siteTitle = title.getTitle();
    inject(TranslateService)
      .stream('web.appInstall.title')
      .pipe(takeUntilDestroyed())
      .subscribe((name: string) => title.setTitle(`${name} — takeAway`));
    inject(DestroyRef).onDestroy(() => title.setTitle(siteTitle));
  }
}
