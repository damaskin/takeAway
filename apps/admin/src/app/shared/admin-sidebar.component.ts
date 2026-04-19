import { Component, computed, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { FeatureFlagsStore } from '../core/config/feature-flags.store';

interface NavItem {
  icon: string;
  label: string;
  link: string;
  exact?: boolean;
  /** Optional runtime gate — hidden when the returned flag is false. */
  requires?: 'deliveryEnabled';
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

  readonly navItems: NavItem[] = [
    { icon: '▦', label: 'admin.nav.dashboard', link: '/dashboard' },
    { icon: '🍽', label: 'admin.nav.menu', link: '/menu' },
    { icon: '🏬', label: 'admin.nav.stores', link: '/stores' },
    { icon: '🧾', label: 'admin.nav.orders', link: '/orders' },
    { icon: '🛵', label: 'admin.nav.dispatch', link: '/dispatch', requires: 'deliveryEnabled' },
    { icon: '🧑‍✈️', label: 'admin.nav.riders', link: '/riders', requires: 'deliveryEnabled' },
    { icon: '🎟', label: 'admin.nav.promo', link: '/promo' },
    { icon: '📊', label: 'admin.nav.analytics', link: '/analytics' },
  ];

  readonly visibleItems = computed(() => {
    const flags = this.flags.flags();
    return this.navItems.filter((item) => !item.requires || flags[item.requires]);
  });
}
