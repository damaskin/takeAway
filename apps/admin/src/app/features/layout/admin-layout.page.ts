import { Component, inject } from '@angular/core';
import { Router, RouterOutlet } from '@angular/router';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';

import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';
import { AdminSidebarComponent } from '../../shared/admin-sidebar.component';

/**
 * Admin layout — pencil F52Ar sidebar + 64px foam top bar.
 *
 * Top bar: 64px height, 32px horizontal padding, border-bottom light.
 * Main content area inherits cream background and lets each page set its own padding.
 */
@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [RouterOutlet, AdminSidebarComponent, LanguageSwitcherComponent, TranslatePipe],
  template: `
    <div class="flex min-h-screen" style="background: var(--color-cream); color: var(--color-text-primary)">
      <app-admin-sidebar />

      <div class="flex-1 flex flex-col min-w-0">
        <header
          class="flex items-center justify-between"
          style="height: 64px; padding: 0 32px; background: var(--color-foam); border-bottom: 1px solid var(--color-border-light)"
        >
          <div class="flex items-center" style="gap: 10px">
            <span
              class="flex items-center justify-center"
              style="width: 34px; height: 34px; border-radius: 9999px; background: var(--color-caramel-light); color: var(--color-caramel); font-family: var(--font-sans); font-size: 13px; font-weight: 700"
            >
              {{ initials() }}
            </span>
            <div class="flex flex-col">
              <span
                style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
                >{{ userName() }}</span
              >
              <span
                style="font-family: var(--font-sans); font-size: 11px; color: var(--color-text-tertiary); letter-spacing: 0.5px"
                >{{ userRole() }}</span
              >
            </div>
          </div>
          <app-language-switcher />
          <button
            type="button"
            (click)="logout()"
            style="font-family: var(--font-sans); font-size: 13px; font-weight: 500; color: var(--color-text-secondary)"
          >
            {{ 'common.signOut' | translate }}
          </button>
        </header>

        <main class="flex-1 overflow-auto" style="background: var(--color-cream)">
          <router-outlet />
        </main>
      </div>
    </div>
  `,
})
export class AdminLayoutPage {
  private readonly auth = inject(AuthService);
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  userName(): string {
    const user = this.store.user();
    return user?.name ?? user?.phone ?? this.translate.instant('common.user');
  }

  userRole(): string {
    return this.store.user()?.role ?? '';
  }

  initials(): string {
    const name = this.userName();
    return name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? '')
      .join('');
  }

  logout(): void {
    this.auth.logout().subscribe({
      complete: () => void this.router.navigate(['/login']),
    });
  }
}
