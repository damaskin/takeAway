import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

interface NavItem {
  icon: string;
  label: string;
  link: string;
  exact?: boolean;
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
  imports: [RouterLink, RouterLinkActive],
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
          >Admin</span
        >
      </div>

      @for (item of navItems; track item.link) {
        <a
          [routerLink]="item.link"
          routerLinkActive="admin-nav-active"
          [routerLinkActiveOptions]="{ exact: item.exact ?? false }"
          class="flex items-center admin-nav"
          style="height: 42px; padding: 0 12px; border-radius: 10px; gap: 10px; font-family: var(--font-sans); font-size: 14px; font-weight: 500"
        >
          <span class="admin-nav-icon" style="font-size: 18px">{{ item.icon }}</span>
          <span>{{ item.label }}</span>
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
  readonly navItems: NavItem[] = [
    { icon: '▦', label: 'Dashboard', link: '/dashboard' },
    { icon: '🍽', label: 'Menu', link: '/menu' },
    { icon: '🏬', label: 'Stores', link: '/stores' },
    { icon: '🧾', label: 'Orders', link: '/orders' },
    { icon: '🎟', label: 'Promo', link: '/promo' },
    { icon: '📊', label: 'Analytics', link: '/analytics' },
  ];
}
