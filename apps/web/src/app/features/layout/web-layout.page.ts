import { Component, inject } from '@angular/core';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';

@Component({
  selector: 'app-web-layout',
  standalone: true,
  imports: [RouterOutlet, RouterLink, RouterLinkActive, TranslatePipe, LanguageSwitcherComponent],
  template: `
    <div class="min-h-screen flex flex-col" style="background: var(--color-cream); color: var(--color-text-primary)">
      <!-- Top nav — pencil L4k2D -->
      <header
        class="sticky top-0 z-10"
        style="background: var(--color-foam); border-bottom: 1px solid var(--color-border-light)"
      >
        <div class="max-w-[1440px] mx-auto flex items-center justify-between" style="height: 72px; padding: 0 80px">
          <a routerLink="/" class="flex items-center gap-2">
            <span
              style="font-family: var(--font-display); font-size: 24px; font-weight: 700; color: var(--color-caramel)"
              >{{ 'common.brand' | translate }}</span
            >
          </a>

          <nav class="flex items-center" style="gap: 32px">
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

          <div class="flex items-center" style="gap: 12px">
            <app-language-switcher />
            @if (isAuthed()) {
              <a
                routerLink="/profile"
                class="flex items-center justify-center"
                style="height: 42px; padding: 0 20px; border: 1.5px solid var(--color-border); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
                >{{ userName() }}</a
              >
              <button
                type="button"
                (click)="logout()"
                style="font-family: var(--font-sans); font-size: 14px; color: var(--color-text-secondary)"
              >
                {{ 'common.signOut' | translate }}
              </button>
            } @else {
              <a
                routerLink="/login"
                class="flex items-center justify-center"
                style="height: 42px; padding: 0 20px; border: 1.5px solid var(--color-border); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
                >{{ 'common.signIn' | translate }}</a
              >
            }
            <a
              routerLink="/menu"
              class="flex items-center justify-center"
              style="height: 42px; padding: 0 20px; background: var(--color-caramel); border-radius: var(--radius-button); font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: white"
              >{{ 'common.order' | translate }}</a
            >
          </div>
        </div>
      </header>

      <main class="flex-1">
        <router-outlet />
      </main>
    </div>
  `,
})
export class WebLayoutPage {
  private readonly store = inject(AuthStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  isAuthed(): boolean {
    return this.store.isAuthenticated();
  }

  userName(): string {
    const u = this.store.user();
    const name = u?.name?.split(/\s+/)[0];
    return name || 'Account';
  }

  logout(): void {
    this.auth.logout().subscribe({
      complete: () => void this.router.navigate(['/']),
    });
  }
}
