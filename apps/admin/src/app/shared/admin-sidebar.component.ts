import { Component, DestroyRef, computed, inject, output } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import type { PlanFeature } from '@takeaway/shared-types';
import { filter } from 'rxjs/operators';
import { BrandLogoComponent } from '@takeaway/ui-kit';

import { AuthStore } from '../core/auth/auth.store';
import { BrandsService } from '../core/brands/brands.service';
import { CampaignModerationApi } from '../core/campaigns/campaign-moderation.service';
import { FeedbackApi } from '../core/feedback/feedback.service';
import { FeatureFlagsStore } from '../core/config/feature-flags.store';
import { OrderAlertsService } from '../core/kitchen/order-alerts.service';
import { PwaService } from '../core/pwa/pwa.service';

import {
  ADMIN_ROLES,
  type AdminRole,
  KITCHEN_SESSION_NAV,
  NAV_PLAN_FEATURE,
  navLink,
} from '../core/permissions/permissions';
import { PlanAccess } from '../core/plans/plan-access.service';

interface NavItem {
  icon: string;
  label: string;
  link: string;
  exact?: boolean;
  /** Optional runtime gate — hidden when the returned flag is false. */
  requires?: 'deliveryEnabled';
  /** Role gate — item is hidden for users whose role is not in this list. */
  roles?: ReadonlyArray<AdminRole>;
  /** A live counter shown next to the label. */
  badge?: 'pendingBrands' | 'pendingOrders' | 'newFeedback' | 'pendingCampaigns';
  /** The plan feature the section needs; without it the item shows a PRO lock and opens the upgrade page. */
  planFeature?: PlanFeature;
}

/** A brand's staff, who write to the platform team — mirrors `@Roles` on `POST /admin/support`. */
const SUPPORT_ROLES: ReadonlyArray<AdminRole> = ['BRAND_ADMIN', 'STORE_MANAGER', 'MENU_EDITOR', 'STAFF'];

/**
 * Admin sidebar — pencil F52Ar (Component/Nav/AdminSidebar).
 *
 * 260px foam column with 24/16 padding:
 *   Logo (Fraunces 22/700 caramel + "Admin" tertiary 11/500)
 *   Nav rows (42px, 10px radius)
 *     active:  caramel-light fill, caramel icon + label
 *     inactive: text-secondary icon + label
 */
@Component({
  selector: 'app-admin-sidebar',
  standalone: true,
  imports: [RouterLink, RouterLinkActive, TranslatePipe, BrandLogoComponent],
  template: `
    <aside
      class="admin-aside flex flex-col"
      style="width: 260px; max-width: 100%; height: 100%; background: var(--color-foam); border-right: 1px solid var(--color-border-light); padding: 24px 16px; gap: 8px"
    >
      <div class="flex items-center" style="gap: 10px; padding: 0 8px 24px 8px">
        <lib-brand-logo [size]="22" />
        <span
          style="font-family: var(--font-sans); font-size: 11px; font-weight: 500; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 1px"
          >{{ 'admin.layout.adminTag' | translate }}</span
        >
      </div>

      @for (item of visibleItems(); track item.label) {
        <a
          [routerLink]="item.link"
          routerLinkActive="admin-nav-active"
          [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
          class="flex items-center admin-nav"
          style="height: 42px; padding: 0 12px; border-radius: 10px; gap: 10px; font-family: var(--font-sans); font-size: 14px; font-weight: 500"
        >
          <span class="admin-nav-icon" style="font-size: 18px">{{ item.icon }}</span>
          <span class="flex-1">{{ item.label | translate }}</span>
          @if (item.badge === 'pendingOrders' && pendingOrders(); as count) {
            <span
              class="admin-nav-badge admin-nav-badge-live"
              [title]="'admin.kitchen.pendingBadge' | translate: { count: count }"
              [attr.aria-label]="'admin.kitchen.pendingBadge' | translate: { count: count }"
              >{{ count }}</span
            >
          }
          @if (item.planFeature && !plans.has(item.planFeature)) {
            <span
              class="admin-nav-lock"
              [title]="'admin.plans.lockedHint' | translate"
              [attr.aria-label]="'admin.plans.lockedHint' | translate"
              >{{ 'admin.plans.proBadge' | translate }}</span
            >
          }
          @if (item.badge === 'pendingBrands' && brandsWaiting(); as count) {
            <span
              class="admin-nav-badge"
              [title]="'admin.brands.waitingBadge' | translate: { brands: pendingBrands(), plans: planRequests() }"
              [attr.aria-label]="
                'admin.brands.waitingBadge' | translate: { brands: pendingBrands(), plans: planRequests() }
              "
              >{{ count }}</span
            >
          }
          @if (item.badge === 'pendingCampaigns' && pendingCampaigns(); as count) {
            <span
              class="admin-nav-badge"
              [title]="'admin.campaignModeration.pendingBadge' | translate: { count: count }"
              [attr.aria-label]="'admin.campaignModeration.pendingBadge' | translate: { count: count }"
              >{{ count }}</span
            >
          }
          @if (item.badge === 'newFeedback' && newFeedback(); as count) {
            <span
              class="admin-nav-badge"
              [title]="'admin.feedback.newBadge' | translate: { count: count }"
              [attr.aria-label]="'admin.feedback.newBadge' | translate: { count: count }"
              >{{ count }}</span
            >
          }
        </a>
      }

      <div class="admin-aside-bottom flex flex-col" style="gap: 8px">
        @if (kitchenOnly()) {
          <p class="admin-pin-note" role="note" data-testid="pin-session-note">
            {{ 'admin.layout.pinSessionNote' | translate }}
          </p>
        }
        @if (canWriteSupport()) {
          <button type="button" class="admin-support flex items-center" (click)="supportRequested.emit()">
            <span style="font-size: 18px" aria-hidden="true">✉</span>
            <span class="flex-1" style="text-align: left">{{ 'admin.support.entry' | translate }}</span>
          </button>
        }
        @if (pwa.canInstall()) {
          <button
            type="button"
            class="admin-install flex items-center"
            (click)="pwa.install()"
            [title]="'admin.layout.installHint' | translate"
          >
            <span style="font-size: 18px">⬇</span>
            <span class="flex-1" style="text-align: left">{{ 'admin.layout.install' | translate }}</span>
          </button>
        }
        <!-- The layout puts the account and sign-out here on a phone. -->
        <ng-content />
      </div>
    </aside>
  `,
  styles: [
    `
      :host {
        display: block;
        height: 100%;
      }
      /* Full height of the screen; a menu taller than that scrolls by itself. */
      .admin-aside {
        overflow-y: auto;
        overscroll-behavior: contain;
      }
      /* Rows keep their height and the column scrolls, not squashes. */
      .admin-aside > * {
        flex-shrink: 0;
      }
      .admin-nav {
        color: var(--color-text-secondary);
      }
      .admin-nav .admin-nav-icon {
        color: var(--color-text-secondary);
      }
      .admin-nav-active {
        background: var(--color-caramel-light);
        color: var(--color-caramel);
        font-weight: 600;
      }
      .admin-nav-active .admin-nav-icon {
        color: var(--color-caramel);
      }
      .admin-nav-badge {
        min-width: 22px;
        height: 22px;
        padding: 0 7px;
        border-radius: 9999px;
        background: var(--color-amber);
        color: white;
        font-size: 12px;
        font-weight: 700;
        line-height: 22px;
        text-align: center;
      }
      .admin-nav-lock {
        padding: 2px 7px;
        border-radius: 9999px;
        border: 1px solid var(--color-border);
        color: var(--color-text-tertiary);
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.6px;
      }
      .admin-nav-badge-live {
        background: var(--color-berry);
      }
      .admin-aside-bottom {
        margin-top: auto;
        padding-top: 8px;
      }
      .admin-install {
        flex: 0 0 auto;
        height: 42px;
        padding: 0 12px;
        gap: 10px;
        border-radius: 10px;
        border: 1px dashed var(--color-border);
        background: transparent;
        color: var(--color-text-secondary);
        font-family: var(--font-sans);
        font-size: 14px;
        font-weight: 500;
      }
      .admin-install:hover {
        color: var(--color-caramel);
        border-color: var(--color-caramel);
      }
      .admin-pin-note {
        margin: 0;
        padding: 10px 12px;
        border-radius: 10px;
        background: var(--color-cream);
        font-family: var(--font-sans);
        font-size: 12px;
        line-height: 1.45;
        color: var(--color-text-secondary);
      }
      .admin-support {
        flex: 0 0 auto;
        height: 42px;
        padding: 0 12px;
        gap: 10px;
        border-radius: 10px;
        border: 1px solid var(--color-border-light);
        background: transparent;
        color: var(--color-text-secondary);
        font-family: var(--font-sans);
        font-size: 14px;
        font-weight: 500;
      }
      .admin-support:hover {
        color: var(--color-caramel);
        border-color: var(--color-caramel);
      }
    `,
  ],
})
export class AdminSidebarComponent {
  private readonly flags = inject(FeatureFlagsStore);
  private readonly authStore = inject(AuthStore);
  private readonly brands = inject(BrandsService);
  private readonly orderAlerts = inject(OrderAlertsService);
  private readonly feedback = inject(FeedbackApi);
  private readonly campaignModeration = inject(CampaignModerationApi);
  readonly pwa = inject(PwaService);
  readonly plans = inject(PlanAccess);

  /** Brands waiting for a platform admin's decision. */
  readonly pendingBrands = computed(() => this.brands.pendingCount() ?? 0);
  /** Owners waiting for an answer about their plan («Перейти на PRO»). */
  readonly planRequests = computed(() => this.brands.planRequests() ?? 0);
  /** Both, on «Бренды»; zero hides the badge. */
  readonly brandsWaiting = computed(() => this.pendingBrands() + this.planRequests());
  /** Business campaigns waiting for review; zero hides the badge. */
  readonly pendingCampaigns = computed(() => this.campaignModeration.pendingCount() ?? 0);
  /** Orders nobody has accepted yet, across the brand's stores; zero hides it. */
  readonly pendingOrders = computed(() => this.orderAlerts.pendingCount());
  /** Customer feedback nobody has read yet; zero hides it. */
  readonly newFeedback = computed(() => this.feedback.newCount() ?? 0);
  /** A brand's staff write to the platform team; the platform team is who they write to. */
  readonly canWriteSupport = computed(() => {
    const role = this.authStore.user()?.role as AdminRole | undefined;
    return role !== undefined && SUPPORT_ROLES.includes(role);
  });
  /**
   * «Написать в поддержку» was pressed. The layout opens the dialog: inside
   * the phone drawer (a transformed box) a fixed dialog would be trapped.
   */
  readonly supportRequested = output<void>();

  constructor() {
    // New applications arrive while the platform admin works, so the count
    // is re-read on every page change rather than once.
    const refresh = () => {
      if (this.authStore.user()?.role !== 'SUPER_ADMIN') return;
      this.brands.loadPendingCount();
      this.feedback.loadNewCount();
      this.campaignModeration.loadPendingCount();
    };
    refresh();
    inject(Router)
      .events.pipe(
        filter((e) => e instanceof NavigationEnd),
        takeUntilDestroyed(inject(DestroyRef)),
      )
      .subscribe(refresh);
  }

  readonly navItems: NavItem[] = [
    { icon: '🌐', label: 'admin.nav.platform', link: '/platform', roles: ADMIN_ROLES.platform },
    // The same page under two names: the platform's «Расчёты с брендами», the owner's «Расчёты».
    { icon: '💸', label: 'admin.nav.settlements', link: '/settlements', roles: ['SUPER_ADMIN'] },
    { icon: '▦', label: 'admin.nav.dashboard', link: '/dashboard', roles: ADMIN_ROLES.dashboard },
    { icon: '🏬', label: 'admin.nav.stores', link: '/stores', roles: ADMIN_ROLES.stores },
    {
      icon: '🔥',
      label: 'admin.nav.kitchen',
      link: '/kitchen',
      roles: ADMIN_ROLES.kitchen,
      badge: 'pendingOrders',
    },
    { icon: '🍽', label: 'admin.nav.menu', link: '/menu', roles: ADMIN_ROLES.menu },
    { icon: '🥛', label: 'admin.nav.ingredients', link: '/ingredients', roles: ADMIN_ROLES.ingredients },
    { icon: '⛔', label: 'admin.nav.stopList', link: '/stop-list', roles: ADMIN_ROLES.stopList },
    { icon: '🧾', label: 'admin.nav.orders', link: '/orders', roles: ADMIN_ROLES.orders },
    {
      icon: '🛵',
      label: 'admin.nav.dispatch',
      link: '/dispatch',
      requires: 'deliveryEnabled',
      roles: ADMIN_ROLES.dispatch,
    },
    {
      icon: '🧑‍✈️',
      label: 'admin.nav.riders',
      link: '/riders',
      requires: 'deliveryEnabled',
      roles: ADMIN_ROLES.riders,
    },
    { icon: '👥', label: 'admin.nav.staff', link: '/staff', roles: ADMIN_ROLES.staff },
    // Promo codes (PRO) and gift cards (every plan) as tabs of one section;
    // the promo tab carries the PRO lock, so the item itself has none.
    { icon: '🎟', label: 'admin.nav.promotions', link: '/promotions', roles: ADMIN_ROLES.promotions },
    {
      icon: '📣',
      label: 'admin.nav.campaigns',
      link: '/campaigns',
      roles: ADMIN_ROLES.campaigns,
      planFeature: NAV_PLAN_FEATURE.campaigns,
    },
    {
      icon: '🛡',
      label: 'admin.nav.campaignModeration',
      link: '/campaign-moderation',
      roles: ADMIN_ROLES.campaignModeration,
      badge: 'pendingCampaigns',
    },
    { icon: '📢', label: 'admin.nav.announcements', link: '/announcements', roles: ADMIN_ROLES.announcements },
    { icon: '📊', label: 'admin.nav.analytics', link: '/analytics', roles: ADMIN_ROLES.analytics },
    { icon: '💸', label: 'admin.nav.settlementsOwn', link: '/settlements', roles: ['BRAND_ADMIN'] },
    {
      icon: '🧑‍🤝‍🧑',
      label: 'admin.nav.customers',
      link: '/customers',
      roles: ADMIN_ROLES.customers,
      planFeature: NAV_PLAN_FEATURE.customers,
    },
    { icon: '🏷', label: 'admin.nav.brands', link: '/brands', roles: ADMIN_ROLES.brands, badge: 'pendingBrands' },
    {
      icon: '💬',
      label: 'admin.nav.feedback',
      link: '/feedback',
      roles: ADMIN_ROLES.feedback,
      badge: 'newFeedback',
    },
    { icon: '⚙', label: 'admin.nav.settings', link: '/settings', roles: ADMIN_ROLES.settings },
    { icon: '🔌', label: 'admin.nav.integrations', link: '/integrations', roles: ADMIN_ROLES.integrations },
    {
      icon: '📨',
      label: 'admin.nav.telegramLink',
      link: '/telegram-link',
      roles: ADMIN_ROLES.telegramLink,
    },
  ];

  /**
   * Signed in with a kitchen PIN: a shared kitchen tablet, which sees the
   * board and the stop-list only. The same person signed in with their
   * password sees every section of their role, so the footer says why the
   * menu is short — otherwise it reads as a bug.
   */
  readonly kitchenOnly = computed(() => this.authStore.kdsStoreId() !== null);

  readonly visibleItems = computed(() => {
    const flags = this.flags.flags();
    const role = this.authStore.user()?.role;
    const kitchenOnly = this.kitchenOnly();
    const kitchenLinks = KITCHEN_SESSION_NAV.map(navLink);
    return this.navItems.filter((item) => {
      if (kitchenOnly && !kitchenLinks.includes(item.link)) return false;
      if (item.requires && !flags[item.requires]) return false;
      if (item.roles && (!role || !item.roles.includes(role as never))) return false;
      return true;
    });
  });
}
