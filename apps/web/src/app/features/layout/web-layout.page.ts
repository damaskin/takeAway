import { Component, inject, signal } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';

/**
 * Web shell — sticky top nav. On desktop the four-link nav lives in the
 * header; on mobile (≤768px) the nav collapses to a hamburger that toggles
 * a sheet under the header. Side gutter uses `clamp(16px, 5vw, 80px)` so
 * the desktop look is preserved while phones don't bleed off-screen.
 */
@Component({
  selector: 'app-web-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe, LanguageSwitcherComponent],
  template: `
    <div class="min-h-screen flex flex-col" style="background: var(--color-cream); color: var(--color-text-primary)">
      <header
        class="sticky top-0 z-10"
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
            <a
              routerLink="/menu"
              routerLinkActive="opacity-100"
              [routerLinkActiveOptions]="{ exact: false }"
              class="opacity-70 hover:opacity-100"
              style="font-family: var(--font-sans); font-size: 15px; font-weight: 500; color: var(--color-text-primary)"
              >{{ 'nav.menu' | translate }}</a
            >
            <a
              routerLink="/stores"
              routerLinkActive="opacity-100"
              class="opacity-70 hover:opacity-100"
              style="font-family: var(--font-sans); font-size: 15px; font-weight: 500; color: var(--color-text-primary)"
              >{{ 'nav.stores' | translate }}</a
            >
            <a
              href="#how-it-works"
              class="opacity-70 hover:opacity-100"
              style="font-family: var(--font-sans); font-size: 15px; font-weight: 500; color: var(--color-text-primary)"
              >{{ 'nav.about' | translate }}</a
            >
            <a
              href="#loyalty"
              class="opacity-70 hover:opacity-100"
              style="font-family: var(--font-sans); font-size: 15px; font-weight: 500; color: var(--color-text-primary)"
              >{{ 'nav.loyalty' | translate }}</a
            >
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
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly mobileNavOpen = signal(false);

  isAuthed(): boolean {
    return this.store.isAuthenticated();
  }

  userName(): string {
    const u = this.store.user();
    const name = u?.name?.split(/\s+/)[0];
    return name || 'Account';
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
