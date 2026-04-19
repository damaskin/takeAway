import { Component, HostListener, inject, signal } from '@angular/core';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { filter } from 'rxjs/operators';

import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';
import { AdminSidebarComponent } from '../../shared/admin-sidebar.component';

/**
 * Admin layout — pencil F52Ar sidebar + 64px foam top bar.
 *
 * Desktop (≥901px): persistent 260px sidebar on the left, 64px top bar on
 * the right.
 *
 * Mobile (≤900px): the sidebar is hidden by default and slides in from the
 * left as an off-canvas drawer when the user taps the hamburger in the top
 * bar. Tapping outside the drawer or following any router link closes it.
 */
@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [RouterOutlet, AdminSidebarComponent, LanguageSwitcherComponent, TranslatePipe],
  template: `
    <div class="admin-shell flex min-h-screen" style="background: var(--color-cream); color: var(--color-text-primary)">
      <!-- Sidebar (drawer on mobile) -->
      <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events,@angular-eslint/template/interactive-supports-focus -->
      <div class="admin-sidebar-wrap" [class.admin-sidebar-open]="sidebarOpen()" (click)="onSidebarTap($event)">
        <app-admin-sidebar />
      </div>

      <!-- Backdrop for mobile drawer -->
      @if (sidebarOpen()) {
        <button
          type="button"
          class="admin-backdrop"
          (click)="closeSidebar()"
          [attr.aria-label]="'common.close' | translate"
        ></button>
      }

      <div class="flex-1 flex flex-col min-w-0">
        <header
          class="admin-topbar flex items-center"
          style="height: 64px; padding: 0 clamp(12px, 3vw, 32px); background: var(--color-foam); border-bottom: 1px solid var(--color-border-light); gap: 12px"
        >
          <button
            type="button"
            class="admin-burger flex items-center justify-center"
            (click)="toggleSidebar()"
            style="width: 38px; height: 38px; border-radius: 10px; background: transparent; color: var(--color-text-primary)"
            [attr.aria-label]="'common.menu' | translate"
            [attr.aria-expanded]="sidebarOpen()"
          >
            <span style="font-size: 22px; line-height: 1">☰</span>
          </button>

          <div class="flex items-center flex-1 min-w-0" style="gap: 10px">
            <span
              class="flex items-center justify-center flex-shrink-0"
              style="width: 34px; height: 34px; border-radius: 9999px; background: var(--color-caramel-light); color: var(--color-caramel); font-family: var(--font-sans); font-size: 13px; font-weight: 700"
            >
              {{ initials() }}
            </span>
            <div class="flex flex-col min-w-0">
              <span
                class="truncate"
                style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
                >{{ userName() }}</span
              >
              <span
                class="truncate"
                style="font-family: var(--font-sans); font-size: 11px; color: var(--color-text-tertiary); letter-spacing: 0.5px"
                >{{ userRole() }}</span
              >
            </div>
          </div>
          <app-language-switcher />
          <button
            type="button"
            (click)="logout()"
            class="admin-signout"
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
  styles: [
    `
      :host {
        display: block;
      }
      .admin-burger {
        display: none;
      }
      .admin-backdrop {
        display: none;
      }
      .admin-sidebar-wrap {
        flex: 0 0 auto;
      }
      @media (max-width: 900px) {
        .admin-burger {
          display: inline-flex;
        }
        .admin-sidebar-wrap {
          position: fixed;
          inset: 0 auto 0 0;
          z-index: 30;
          transform: translateX(-100%);
          transition: transform 200ms ease;
          box-shadow: 4px 0 18px rgba(0, 0, 0, 0.18);
        }
        .admin-sidebar-wrap.admin-sidebar-open {
          transform: translateX(0);
        }
        .admin-backdrop {
          display: block;
          position: fixed;
          inset: 0;
          background: rgba(0, 0, 0, 0.4);
          z-index: 20;
          border: 0;
          padding: 0;
        }
      }
      @media (max-width: 480px) {
        .admin-signout {
          display: none;
        }
      }
    `,
  ],
})
export class AdminLayoutPage {
  private readonly auth = inject(AuthService);
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);

  readonly sidebarOpen = signal(false);

  constructor() {
    // Auto-close the drawer on route change so tapping a sidebar link doesn't
    // leave the overlay covering the new page.
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe(() => this.sidebarOpen.set(false));
  }

  @HostListener('window:keydown.escape')
  onEscape(): void {
    this.sidebarOpen.set(false);
  }

  toggleSidebar(): void {
    this.sidebarOpen.update((v) => !v);
  }

  closeSidebar(): void {
    this.sidebarOpen.set(false);
  }

  /**
   * The wrapping div catches clicks on the sidebar drawer; tapping a link
   * inside the sidebar should close the drawer (after Router navigates), and
   * empty space inside the drawer should not. The router-event subscription
   * above handles the navigation case generically — this is just a no-op
   * marker so the click event doesn't bubble to the backdrop.
   */
  onSidebarTap(event: MouseEvent): void {
    event.stopPropagation();
  }

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
