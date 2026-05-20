/**
 * Single source of truth for which admin role can see which navigation
 * section. Powers both the sidebar (`AdminSidebarComponent`) and the
 * route guard (`adminPermissionGuard`).
 *
 * RIDER is intentionally absent from every entry: couriers use the rider
 * app, not the admin panel. They can still log in for the change-password
 * flow but get bounced from any feature route.
 */

export type AdminRole = 'SUPER_ADMIN' | 'BRAND_ADMIN' | 'STORE_MANAGER' | 'MENU_EDITOR' | 'STAFF' | 'RIDER';

export type NavKey =
  | 'dashboard'
  | 'menu'
  | 'stores'
  | 'orders'
  | 'dispatch'
  | 'riders'
  | 'staff'
  | 'promo'
  | 'giftCards'
  | 'campaigns'
  | 'analytics'
  | 'brands'
  | 'settings'
  | 'integrations'
  | 'telegramLink';

const SA = 'SUPER_ADMIN' as const;
const BA = 'BRAND_ADMIN' as const;
const SM = 'STORE_MANAGER' as const;
const ME = 'MENU_EDITOR' as const;
const ST = 'STAFF' as const;

export const ADMIN_ROLES: Record<NavKey, ReadonlyArray<AdminRole>> = {
  dashboard: [SA, BA, SM, ST],
  menu: [SA, BA, SM, ME],
  stores: [SA, BA, SM, ST],
  orders: [SA, BA, SM, ST],
  dispatch: [SA, BA, SM],
  riders: [SA, BA, SM],
  staff: [SA, BA, SM],
  promo: [SA, BA],
  giftCards: [SA, BA],
  campaigns: [SA, BA],
  analytics: [SA, BA],
  brands: [SA],
  settings: [SA, BA],
  integrations: [SA, BA],
  telegramLink: [BA, SM, ME, ST],
};

export function canAccess(role: AdminRole | undefined | null, key: NavKey): boolean {
  if (!role) return false;
  return ADMIN_ROLES[key].includes(role);
}

/** First nav section accessible to the given role — used as a landing fallback. */
export function defaultLandingFor(role: AdminRole | undefined | null): string {
  if (!role) return '/login';
  const order: NavKey[] = ['dashboard', 'orders', 'menu', 'stores', 'analytics', 'settings'];
  for (const k of order) {
    if (canAccess(role, k)) return navLink(k);
  }
  return '/change-password';
}

const NAV_LINKS: Record<NavKey, string> = {
  dashboard: '/dashboard',
  menu: '/menu',
  stores: '/stores',
  orders: '/orders',
  dispatch: '/dispatch',
  riders: '/riders',
  staff: '/staff',
  promo: '/promo',
  giftCards: '/gift-cards',
  campaigns: '/campaigns',
  analytics: '/analytics',
  brands: '/brands',
  settings: '/settings',
  integrations: '/integrations',
  telegramLink: '/telegram-link',
};

export function navLink(key: NavKey): string {
  return NAV_LINKS[key];
}
