import { ViewportScroller } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterOutlet } from '@angular/router';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { filter, map } from 'rxjs';

import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';
import { stickyTopInset } from '../../core/layout/sticky-inset';

/**
 * Web shell — sticky top nav. On desktop the four-link nav lives in the
 * header; on mobile (≤768px) the nav collapses to a hamburger that toggles
 * a sheet under the header. Side gutter uses `clamp(16px, 5vw, 80px)` so
 * the desktop look is preserved while phones don't bleed off-screen.
 */
@Component({
  selector: 'app-web-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, TranslatePipe, LanguageSwitcherComponent],
  template: `
    <div class="min-h-screen flex flex-col" style="background: var(--color-cream); color: var(--color-text-primary)">
      <header
        class="sticky top-0 z-10"
        data-sticky-top
        style="background: var(--color-foam); border-bottom: 1px solid var(--color-border-light)"
      >
        <div
          class="max-w-[1440px] mx-auto flex items-center justify-between"
          style="height: 72px; padding: 0 clamp(16px, 5vw, 80px)"
        >
          <!-- Brand + hamburger (mobile) -->
          <div class="flex items-center" style="gap: 12px">
            <button
              type="button"
              (click)="toggleMobileNav()"
              class="web-nav-burger flex items-center justify-center"
              style="width: 40px; height: 40px; border-radius: 10px; background: transparent; color: var(--color-text-primary)"
              [attr.aria-expanded]="mobileNavOpen()"
              [attr.aria-label]="'common.menu' | translate"
            >
              <span style="font-size: 22px; line-height: 1">{{ mobileNavOpen() ? '✕' : '☰' }}</span>
            </button>
            <a routerLink="/" class="flex items-center gap-2" (click)="closeMobileNav()">
              <span
                style="font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-caramel)"
                >{{ 'common.brand' | translate }}</span
              >
            </a>
          </div>

          <!-- Desktop primary nav -->
          <nav class="web-nav-desktop items-center" style="gap: 32px">
            <a routerLink="/menu" class="web-nav-link" [class.is-active]="section() === 'menu'">{{
              'nav.menu' | translate
            }}</a>
            <a routerLink="/stores" class="web-nav-link" [class.is-active]="section() === 'stores'">{{
              'nav.stores' | translate
            }}</a>
            <a routerLink="/" fragment="how-it-works" class="web-nav-link">{{ 'nav.about' | translate }}</a>
            <a routerLink="/" fragment="loyalty" class="web-nav-link">{{ 'nav.loyalty' | translate }}</a>
          </nav>

          <!-- Right cluster: language + auth + order. Wraps to icons on mobile. -->
          <div class="flex items-center web-nav-right" style="gap: 8px">
            <app-language-switcher />
            @if (isAuthed()) {
              <a
                routerLink="/profile"
                class="web-nav-account flex items-center justify-center"
                style="height: 42px; padding: 0 16px; border: 1.5px solid var(--color-border); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary); white-space: nowrap"
                >{{ userName() }}</a
              >
            } @else {
              <a
                routerLink="/login"
                class="web-nav-account flex items-center justify-center"
                style="height: 42px; padding: 0 16px; border: 1.5px solid var(--color-border); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary); white-space: nowrap"
                >{{ 'common.signIn' | translate }}</a
              >
            }
            <a
              routerLink="/menu"
              class="flex items-center justify-center"
              style="height: 42px; padding: 0 16px; background: var(--color-caramel); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: white; white-space: nowrap"
              >{{ 'common.order' | translate }}</a
            >
          </div>
        </div>

        <!-- Mobile drop-down nav sheet -->
        @if (mobileNavOpen()) {
          <nav
            class="web-nav-mobile flex flex-col"
            style="background: var(--color-foam); border-top: 1px solid var(--color-border-light); padding: 12px clamp(16px, 5vw, 80px); gap: 4px"
          >
            <a
              routerLink="/menu"
              (click)="closeMobileNav()"
              style="padding: 12px 8px; font-family: var(--font-sans); font-size: 16px; font-weight: 500; color: var(--color-text-primary); border-radius: 10px"
              >{{ 'nav.menu' | translate }}</a
            >
            <a
              routerLink="/stores"
              (click)="closeMobileNav()"
              style="padding: 12px 8px; font-family: var(--font-sans); font-size: 16px; font-weight: 500; color: var(--color-text-primary); border-radius: 10px"
              >{{ 'nav.stores' | translate }}</a
            >
            @if (isAuthed()) {
              <a
                routerLink="/orders"
                (click)="closeMobileNav()"
                style="padding: 12px 8px; font-family: var(--font-sans); font-size: 16px; font-weight: 500; color: var(--color-text-primary); border-radius: 10px"
                >{{ 'web.orders.title' | translate }}</a
              >
              <a
                routerLink="/profile"
                (click)="closeMobileNav()"
                style="padding: 12px 8px; font-family: var(--font-sans); font-size: 16px; font-weight: 500; color: var(--color-text-primary); border-radius: 10px"
                >{{ 'nav.profile' | translate }}</a
              >
              <button
                type="button"
                (click)="logout(); closeMobileNav()"
                class="text-left"
                style="padding: 12px 8px; font-family: var(--font-sans); font-size: 16px; font-weight: 500; color: var(--color-berry); border-radius: 10px; background: transparent"
              >
                {{ 'common.signOut' | translate }}
              </button>
            }
          </nav>
        }
      </header>

      <main class="flex-1">
        <router-outlet />
      </main>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .web-nav-burger {
        display: none;
      }
      .web-nav-link {
        position: relative;
        padding: 6px 0;
        font-family: var(--font-sans);
        font-size: 15px;
        font-weight: 500;
        color: var(--color-text-primary);
        opacity: 0.7;
        transition: opacity 0.15s;
      }
      .web-nav-link:hover,
      .web-nav-link.is-active {
        opacity: 1;
      }
      .web-nav-link.is-active::after {
        content: '';
        position: absolute;
        left: 0;
        right: 0;
        bottom: -2px;
        height: 2px;
        border-radius: 2px;
        background: var(--color-caramel);
      }
      .web-nav-desktop {
        display: flex;
      }
      .web-nav-mobile {
        display: none;
      }
      @media (max-width: 900px) {
        .web-nav-burger {
          display: inline-flex;
        }
        .web-nav-desktop {
          display: none;
        }
        .web-nav-mobile {
          display: flex;
        }
        .web-nav-account {
          display: none;
        }
      }
      @media (max-width: 480px) {
        .web-nav-right {
          gap: 6px !important;
        }
      }
    `,
  ],
})
export class WebLayoutPage {
  private readonly store = inject(AuthStore);
  private readonly translate = inject(TranslateService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly mobileNavOpen = signal(false);

  private readonly url = toSignal(
    this.router.events.pipe(
      filter((e): e is NavigationEnd => e instanceof NavigationEnd),
      map((e) => e.urlAfterRedirects),
    ),
    { initialValue: this.router.url },
  );

  /**
   * Which header link the page belongs to. A store's own page is its menu,
   * so it lights up "Меню" rather than "Точки", and so does a product.
   */
  readonly section = computed<'menu' | 'stores' | null>(() => {
    const path = this.url().split(/[?#]/)[0] ?? '';
    if (/^\/(menu|products\/|stores\/[^/]+)/.test(path)) return 'menu';
    if (/^\/stores\/?$/.test(path)) return 'stores';
    return null;
  });

  constructor() {
    // "О нас" and "Лояльность" jump to home-page sections: land them below
    // the header instead of under it.
    inject(ViewportScroller).setOffset(() => [0, stickyTopInset() + 16]);
  }

  isAuthed(): boolean {
    return this.store.isAuthenticated();
  }

  userName(): string {
    const u = this.store.user();
    const name = u?.name?.split(/\s+/)[0];
    return name || this.translate.instant('web.profile.account');
  }

  toggleMobileNav(): void {
    this.mobileNavOpen.update((v) => !v);
  }

  closeMobileNav(): void {
    this.mobileNavOpen.set(false);
  }

  logout(): void {
    this.auth.logout().subscribe({
      complete: () => void this.router.navigate(['/']),
    });
  }
}
