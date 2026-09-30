import { Component, ElementRef, HostListener, OnInit, computed, inject, signal, viewChild } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { NavigationEnd, Router, RouterOutlet } from '@angular/router';
import { LanguageSwitcherComponent } from '@takeaway/i18n';
import { TranslatePipe, TranslateService } from '@ngx-translate/core';
import { filter } from 'rxjs/operators';

import { AuthService } from '../../core/auth/auth.service';
import { AuthStore } from '../../core/auth/auth.store';
import { ActiveBrandService } from '../../core/brand-context/active-brand.service';
import { KitchenModeService } from '../../core/kitchen/kitchen-mode.service';
import { KitchenRealtimeService } from '../../core/kitchen/kitchen-realtime.service';
import { OrderAlertsService } from '../../core/kitchen/order-alerts.service';
import { type AdminRole, canAccess } from '../../core/permissions/permissions';
import { AdminSidebarComponent } from '../../shared/admin-sidebar.component';
import { BrandStatusBannerComponent } from './brand-status-banner.component';
import { OrderAlertsComponent } from './order-alerts.component';

/** Roles with a name of their own under `admin.layout.role`. */
const NAMED_ROLES = new Set(['SUPER_ADMIN', 'BRAND_ADMIN', 'STORE_MANAGER', 'MENU_EDITOR', 'STAFF', 'RIDER']);

/**
 * Admin layout — pencil F52Ar sidebar + 64px foam top bar.
 *
 * An app shell rather than a scrolling document: the shell is exactly one
 * viewport tall and only `<main>` scrolls, so the top bar and the sidebar
 * stay where they are however long the page is — the way an installed app
 * behaves, and the admin can be installed as one (see public/manifest).
 *
 * Desktop (≥901px): persistent 260px sidebar the full height of the screen
 * on the left (it scrolls on its own if the menu is taller than the
 * screen), 64px top bar over the page on the right.
 *
 * Mobile (≤900px): the top bar stays pinned; the sidebar is hidden and
 * slides in from the left as an off-canvas drawer when the user taps the
 * hamburger. Tapping the backdrop, pressing Escape or following any router
 * link closes it.
 */
@Component({
  selector: 'app-admin-layout',
  standalone: true,
  imports: [
    RouterOutlet,
    FormsModule,
    AdminSidebarComponent,
    BrandStatusBannerComponent,
    OrderAlertsComponent,
    LanguageSwitcherComponent,
    TranslatePipe,
  ],
  template: `
    <div
      class="admin-shell flex"
      [class.admin-bare]="bare()"
      style="background: var(--color-cream); color: var(--color-text-primary)"
    >
      <!-- Sidebar (drawer on mobile) -->
      <!-- eslint-disable-next-line @angular-eslint/template/click-events-have-key-events,@angular-eslint/template/interactive-supports-focus -->
      <div
        id="admin-sidebar"
        class="admin-sidebar-wrap"
        [class.admin-sidebar-open]="sidebarOpen()"
        (click)="onSidebarTap($event)"
      >
        <app-admin-sidebar>
          <!-- On a phone the top bar has no room for the account: it lives
               at the foot of the drawer instead. -->
          <div class="admin-drawer-account flex items-center">
            <span
              class="flex items-center justify-center flex-shrink-0"
              style="width: 34px; height: 34px; border-radius: 9999px; background: var(--color-caramel-light); color: var(--color-caramel); font-family: var(--font-sans); font-size: 13px; font-weight: 700"
            >
              {{ initials() }}
            </span>
            <div class="flex flex-col min-w-0 flex-1">
              <span
                class="truncate"
                style="font-family: var(--font-sans); font-size: 14px; font-weight: 600; color: var(--color-text-primary)"
                >{{ userName() }}</span
              >
              <span
                class="truncate"
                style="font-family: var(--font-sans); font-size: 11px; color: var(--color-text-tertiary); letter-spacing: 0.5px"
                >{{ roleLabel() | translate }}</span
              >
            </div>
            <button
              type="button"
              (click)="logout()"
              style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-caramel); padding: 8px 4px"
            >
              {{ 'common.signOut' | translate }}
            </button>
          </div>
        </app-admin-sidebar>
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

      <div class="admin-column flex-1 flex flex-col min-w-0">
        <header
          class="admin-topbar flex items-center"
          style="flex: 0 0 64px; height: 64px; padding: 0 clamp(12px, 3vw, 32px); background: var(--color-foam); border-bottom: 1px solid var(--color-border-light); gap: 12px"
        >
          <button
            type="button"
            class="admin-burger flex items-center justify-center"
            (click)="toggleSidebar()"
            style="width: 38px; height: 38px; border-radius: 10px; background: transparent; color: var(--color-text-primary)"
            [attr.aria-label]="'common.menu' | translate"
            [attr.aria-expanded]="sidebarOpen()"
            aria-controls="admin-sidebar"
          >
            <span style="font-size: 22px; line-height: 1">☰</span>
          </button>

          <div class="admin-account flex items-center flex-1 min-w-0" style="gap: 10px">
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
                >{{ roleLabel() | translate }}</span
              >
            </div>
          </div>

          @if (showBrandSelector()) {
            <label class="admin-brand-picker flex items-center" style="gap: 6px">
              <span
                class="admin-brand-picker-label"
                style="font-family: var(--font-sans); font-size: 11px; color: var(--color-text-tertiary); letter-spacing: 0.5px; text-transform: uppercase"
                >{{ 'admin.layout.brand' | translate }}</span
              >
              <select
                [ngModel]="onPlatform() ? PROJECT : activeBrand.activeId()"
                (ngModelChange)="selectBrand($event)"
                style="height: 34px; padding: 0 28px 0 10px; background: var(--color-foam); border: 1px solid var(--color-border-light); border-radius: 10px; font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-primary); min-width: 160px"
              >
                @if (isPlatformAdmin()) {
                  <option [value]="PROJECT">{{ 'admin.layout.wholeProject' | translate }}</option>
                }
                @for (b of activeBrand.brands(); track b.id) {
                  <option [value]="b.id">{{ b.name }}</option>
                }
              </select>
            </label>
          } @else if (singleBrandName(); as name) {
            <span
              class="admin-brand-single truncate"
              style="font-family: var(--font-sans); font-size: 13px; font-weight: 600; color: var(--color-text-secondary); max-width: 200px"
              [title]="name"
              >{{ name }}</span
            >
          }

          @if (hearsOrders()) {
            <button
              type="button"
              class="admin-sound flex items-center justify-center"
              (click)="orderAlerts.toggleSound()"
              [attr.aria-pressed]="orderAlerts.soundOn()"
              [title]="
                (orderAlerts.soundOn() ? 'admin.kitchen.alerts.soundOn' : 'admin.kitchen.alerts.soundOff') | translate
              "
              [attr.aria-label]="
                (orderAlerts.soundOn() ? 'admin.kitchen.alerts.soundOn' : 'admin.kitchen.alerts.soundOff') | translate
              "
              style="width: 38px; height: 38px; border-radius: 10px; font-size: 18px"
            >
              {{ orderAlerts.soundOn() ? '🔔' : '🔕' }}
            </button>
          }
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

        <main #scroller class="admin-main flex-1 overflow-auto" style="background: var(--color-cream)">
          <app-brand-status-banner />
          <router-outlet />
        </main>
        <app-order-alerts />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      /*
       * One viewport tall, never taller: the top bar and the sidebar are
       * pinned because nothing outside <main> ever scrolls. dvh rather than
       * vh so a phone's collapsing address bar cannot push the bottom of
       * the page under the browser chrome; vh is the fallback.
       */
      .admin-shell {
        height: 100vh;
        height: 100dvh;
        overflow: hidden;
      }
      .admin-column {
        min-height: 0;
      }
      .admin-main {
        min-height: 0;
        overscroll-behavior: contain;
        -webkit-overflow-scrolling: touch;
      }
      .admin-burger {
        display: none;
      }
      /* Kitchen tablet mode: the board takes the whole screen. */
      .admin-bare .admin-sidebar-wrap,
      .admin-bare .admin-topbar {
        display: none !important;
      }
      .admin-backdrop {
        display: none;
      }
      .admin-drawer-account {
        display: none;
        gap: 10px;
        padding: 12px 8px 4px;
        border-top: 1px solid var(--color-border-light);
      }
      .admin-sidebar-wrap {
        flex: 0 0 auto;
        height: 100%;
      }
      @media (max-width: 900px) {
        .admin-burger {
          display: inline-flex;
        }
        .admin-drawer-account {
          display: flex;
        }
        .admin-sidebar-wrap {
          position: fixed;
          inset: 0 auto 0 0;
          z-index: 30;
          transform: translateX(-100%);
          transition:
            transform 220ms cubic-bezier(0.2, 0, 0, 1),
            visibility 0s linear 220ms;
          visibility: hidden;
          max-width: 85vw;
          box-shadow: 4px 0 18px rgba(0, 0, 0, 0.18);
        }
        /* Hidden drawers stay out of the tab order and screen readers. */
        .admin-sidebar-wrap.admin-sidebar-open {
          transform: translateX(0);
          visibility: visible;
          transition: transform 220ms cubic-bezier(0.2, 0, 0, 1);
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
      @media (prefers-reduced-motion: reduce) {
        .admin-sidebar-wrap {
          transition: none !important;
        }
      }
      @media (max-width: 720px) {
        .admin-brand-picker-label,
        .admin-brand-single {
          display: none;
        }
      }
      /* A phone: the account and sign-out move into the drawer. */
      @media (max-width: 600px) {
        .admin-account {
          visibility: hidden;
        }
        .admin-signout {
          display: none;
        }
        .admin-brand-picker select {
          min-width: 0 !important;
          max-width: 46vw;
        }
      }
    `,
  ],
})
export class AdminLayoutPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly store = inject(AuthStore);
  private readonly router = inject(Router);
  private readonly translate = inject(TranslateService);
  readonly activeBrand = inject(ActiveBrandService);
  readonly orderAlerts = inject(OrderAlertsService);
  private readonly realtime = inject(KitchenRealtimeService);

  /** Roles that take orders on get the chime toggle; the others hear nothing anyway. */
  readonly hearsOrders = computed(() => canAccess(this.store.user()?.role as AdminRole | undefined, 'kitchen'));

  readonly sidebarOpen = signal(false);

  /** The one scrolling element of the shell. */
  private readonly scroller = viewChild<ElementRef<HTMLElement>>('scroller');
  private lastPath = '';

  /** The picker's entry for the platform view rather than one brand. */
  readonly PROJECT = '__project__';
  readonly isPlatformAdmin = computed(() => this.store.user()?.role === 'SUPER_ADMIN');
  /** True on the "whole project" page, where no single brand is in view. */
  readonly onPlatform = signal(false);
  private readonly onKitchen = signal(false);
  private readonly kitchenMode = inject(KitchenModeService);
  /** The kitchen board in tablet mode hides the sidebar and the top bar. */
  readonly bare = computed(() => this.onKitchen() && this.kitchenMode.tablet());

  readonly showBrandSelector = computed(() => this.isPlatformAdmin() || this.activeBrand.brands().length > 1);
  readonly singleBrandName = computed(() => {
    const brands = this.activeBrand.brands();
    const only = brands.length === 1 ? brands[0] : null;
    return only?.name ?? null;
  });

  constructor() {
    // Auto-close the drawer on route change so tapping a sidebar link doesn't
    // leave the overlay covering the new page.
    this.onPlatform.set(this.router.url.startsWith('/platform'));
    this.onKitchen.set(this.router.url.startsWith('/kitchen'));
    this.lastPath = pathOf(this.router.url);
    this.router.events.pipe(filter((e) => e instanceof NavigationEnd)).subscribe((e) => {
      this.sidebarOpen.set(false);
      this.onPlatform.set(e.urlAfterRedirects.startsWith('/platform'));
      this.onKitchen.set(e.urlAfterRedirects.startsWith('/kitchen'));
      // <main> scrolls, not the window, so the router's own scroll handling
      // never sees it: a new page would open scrolled as far down as the
      // last one. A query-only change (a filter, a tab) keeps its place.
      const path = pathOf(e.urlAfterRedirects);
      if (path !== this.lastPath) this.scroller()?.nativeElement.scrollTo({ top: 0 });
      this.lastPath = path;
    });
  }

  ngOnInit(): void {
    this.activeBrand.refresh();
  }

  /**
   * A platform admin picks either the whole project or one brand; picking a
   * brand from the project view opens that brand's dashboard, the way its
   * owner lands.
   */
  selectBrand(id: string): void {
    if (id === this.PROJECT) {
      void this.router.navigate(['/platform']);
      return;
    }
    this.activeBrand.select(id);
    if (this.onPlatform()) void this.router.navigate(['/dashboard']);
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

  /** Translation key of the role under the user's name — "Владелец бренда", not "BRAND_ADMIN". */
  roleLabel(): string {
    const role = this.store.user()?.role;
    return role && NAMED_ROLES.has(role) ? `admin.layout.role.${role}` : '';
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
      complete: () => {
        this.realtime.disconnect();
        this.activeBrand.reset();
        void this.router.navigate(['/login']);
      },
    });
  }
}

function pathOf(url: string): string {
  return url.split(/[?#]/)[0] ?? url;
}
