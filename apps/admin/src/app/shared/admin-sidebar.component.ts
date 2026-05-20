import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { AuthStore } from '../core/auth/auth.store';
import { FeatureFlagsStore } from '../core/config/feature-flags.store';

import { ADMIN_ROLES, type AdminRole } from '../core/permissions/permissions';

interface NavItem {
  icon: string;
  label: string;
  link: string;
  exact?: boolean;
  /** Optional runtime gate — hidden when the returned flag is false. */
  requires?: 'deliveryEnabled';
  /** Role gate — item is hidden for users whose role is not in this list. */
  roles?: ReadonlyArray<AdminRole>;
}

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
  imports: [RouterLink, RouterLinkActive, TranslatePipe],
  template: `
    <aside
      class="flex flex-col"
      style="width: 260px; background: var(--color-foam); border-right: 1px solid var(--color-border-light); padding: 24px 16px; gap: 8px"
    >
      <div class="flex items-center" style="gap: 10px; padding: 0 8px 24px 8px">
        <span style="font-family: var(--font-display); font-size: 22px; font-weight: 700; color: var(--color-caramel)"
          >takeAway</span
        >
        <span
          style="font-family: var(--font-sans); font-size: 11px; font-weight: 500; color: var(--color-text-tertiary); text-transform: uppercase; letter-spacing: 1px"
          >{{ 'admin.layout.adminTag' | translate }}</span
        >
      </div>

      @for (item of visibleItems(); track item.link) {
        <a
          [routerLink]="item.link"
          routerLinkActive="admin-nav-active"
          [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
          class="flex items-center admin-nav"
          style="height: 42px; padding: 0 12px; border-radius: 10px; gap: 10px; font-family: var(--font-sans); font-size: 14px; font-weight: 500"
        >
          <span class="admin-nav-icon" style="font-size: 18px">{{ item.icon }}</span>
          <span>{{ item.label | translate }}</span>
        </a>
      }
    </aside>
  `,
  styles: [
    `
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
    `,
  ],
})
export class AdminSidebarComponent {
  private readonly flags = inject(FeatureFlagsStore);
  private readonly authStore = inject(AuthStore);

  readonly navItems: NavItem[] = [
    { icon: '▦', label: 'admin.nav.dashboard', link: '/dashboard', roles: ADMIN_ROLES.dashboard },
    { icon: '🍽', label: 'admin.nav.menu', link: '/menu', roles: ADMIN_ROLES.menu },
    { icon: '🏬', label: 'admin.nav.stores', link: '/stores', roles: ADMIN_ROLES.stores },
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
    { icon: '🎟', label: 'admin.nav.promo', link: '/promo', roles: ADMIN_ROLES.promo },
    { icon: '🎁', label: 'admin.nav.giftCards', link: '/gift-cards', roles: ADMIN_ROLES.giftCards },
    { icon: '📣', label: 'admin.nav.campaigns', link: '/campaigns', roles: ADMIN_ROLES.campaigns },
    { icon: '📊', label: 'admin.nav.analytics', link: '/analytics', roles: ADMIN_ROLES.analytics },
    { icon: '🏷', label: 'admin.nav.brands', link: '/brands', roles: ADMIN_ROLES.brands },
    { icon: '⚙', label: 'admin.nav.settings', link: '/settings', roles: ADMIN_ROLES.settings },
    { icon: '🔌', label: 'admin.nav.integrations', link: '/integrations', roles: ADMIN_ROLES.integrations },
    {
      icon: '📨',
      label: 'admin.nav.telegramLink',
      link: '/telegram-link',
      roles: ADMIN_ROLES.telegramLink,
    },
  ];

  readonly visibleItems = computed(() => {
    const flags = this.flags.flags();
    const role = this.authStore.user()?.role;
    return this.navItems.filter((item) => {
      if (item.requires && !flags[item.requires]) return false;
      if (item.roles && (!role || !item.roles.includes(role as never))) return false;
      return true;
    });
  });
}
