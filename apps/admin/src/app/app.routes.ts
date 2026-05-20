import { inject } from '@angular/core';
import { ActivatedRouteSnapshot, Route, Router } from '@angular/router';

import { anonymousGuard, authGuard } from './core/auth/auth.guard';
import { AuthStore } from './core/auth/auth.store';
import { FeatureFlagsStore } from './core/config/feature-flags.store';
import { type AdminRole, type NavKey, canAccess, defaultLandingFor } from './core/permissions/permissions';

/**
 * If the signed-in user was invited with a temp password, force them to
 * the change-password screen before they can reach any other page.
 */
const forcePasswordChange = () => {
  const store = inject(AuthStore);
  const router = inject(Router);
  if (store.mustChangePassword()) return router.createUrlTree(['/change-password']);
  return true;
};

/**
 * Route guard: blocks a delivery-only page when the module is disabled.
 * Redirects to `/` so the user lands on the dashboard instead of a stuck
 * loader.
 */
const deliveryEnabledGuard = () => {
  const flags = inject(FeatureFlagsStore);
  const router = inject(Router);
  if (flags.deliveryEnabled()) return true;
  return router.createUrlTree(['/']);
};

/**
 * Riders don't see the full admin shell — they land on a compact
 * `/rider` layout and can't click through to dashboard/menu/etc. The
 * `redirectRiderToRiderHome` guard intercepts `/` for them. Staff
 * and higher roles fall through to the normal shell.
 *
 * When delivery is disabled globally, RIDER users have no workspace;
 * send them to `/login` rather than looping them onto `/rider` that
 * the guard would bounce back.
 */
const redirectRiderToRiderHome = () => {
  const store = inject(AuthStore);
  const flags = inject(FeatureFlagsStore);
  const router = inject(Router);
  if (store.user()?.role === 'RIDER') {
    if (!flags.deliveryEnabled()) return router.createUrlTree(['/login']);
    return router.createUrlTree(['/rider']);
  }
  return true;
};

/**
 * Per-route permission guard. Reads the required `navKey` from route data
 * and bounces the user to their default landing if their role lacks
 * access. Set `data: { navKey }` on every feature child route.
 */
const adminPermissionGuard = (route: ActivatedRouteSnapshot) => {
  const store = inject(AuthStore);
  const router = inject(Router);
  const navKey = route.data['navKey'] as NavKey | undefined;
  if (!navKey) return true;
  const role = store.user()?.role as AdminRole | undefined;
  if (canAccess(role, navKey)) return true;
  return router.createUrlTree([defaultLandingFor(role)]);
};

/** Redirect '/' to the first nav section the user can actually see. */
const redirectToFirstAllowed = () => {
  const store = inject(AuthStore);
  const router = inject(Router);
  const role = store.user()?.role as AdminRole | undefined;
  return router.createUrlTree([defaultLandingFor(role)]);
};

export const appRoutes: Route[] = [
  {
    path: 'login',
    canMatch: [anonymousGuard],
    loadComponent: () => import('./features/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: 'signup',
    canMatch: [anonymousGuard],
    loadComponent: () => import('./features/signup/signup.page').then((m) => m.SignupPage),
  },
  {
    path: 'forgot-password',
    canMatch: [anonymousGuard],
    loadComponent: () => import('./features/forgot-password/forgot-password.page').then((m) => m.ForgotPasswordPage),
  },
  {
    path: 'reset-password',
    loadComponent: () => import('./features/reset-password/reset-password.page').then((m) => m.ResetPasswordPage),
  },
  {
    path: 'change-password',
    canMatch: [authGuard],
    loadComponent: () => import('./features/change-password/change-password.page').then((m) => m.ChangePasswordPage),
  },
  {
    path: 'rider',
    canMatch: [authGuard],
    canActivate: [deliveryEnabledGuard],
    loadComponent: () => import('./features/rider/rider.page').then((m) => m.RiderPage),
  },
  {
    path: '',
    canMatch: [authGuard],
    canActivate: [forcePasswordChange, redirectRiderToRiderHome],
    loadComponent: () => import('./features/layout/admin-layout.page').then((m) => m.AdminLayoutPage),
    children: [
      { path: '', pathMatch: 'full', canActivate: [redirectToFirstAllowed], children: [] },
      {
        path: 'dashboard',
        canActivate: [adminPermissionGuard],
        data: { navKey: 'dashboard' satisfies NavKey },
        loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'menu',
        canActivate: [adminPermissionGuard],
        data: { navKey: 'menu' satisfies NavKey },
        loadComponent: () => import('./features/menu/menu.page').then((m) => m.MenuPage),
      },
      {
        path: 'stores',
        canActivate: [adminPermissionGuard],
        data: { navKey: 'stores' satisfies NavKey },
        loadComponent: () => import('./features/stores/stores.page').then((m) => m.StoresPage),
      },
      {
        path: 'orders',
        canActivate: [adminPermissionGuard],
        data: { navKey: 'orders' satisfies NavKey },
        loadComponent: () => import('./features/orders/orders.page').then((m) => m.AdminOrdersPage),
      },
      {
        path: 'dispatch',
        canActivate: [deliveryEnabledGuard, adminPermissionGuard],
        data: { navKey: 'dispatch' satisfies NavKey },
        loadComponent: () => import('./features/dispatch/dispatch.page').then((m) => m.DispatchPage),
      },
      {
        path: 'riders',
        canActivate: [adminPermissionGuard],
        data: { navKey: 'riders' satisfies NavKey },
        loadComponent: () => import('./features/riders/riders.page').then((m) => m.AdminRidersPage),
      },
      {
        path: 'staff',
        canActivate: [adminPermissionGuard],
        data: { navKey: 'staff' satisfies NavKey },
        loadComponent: () => import('./features/staff/staff.page').then((m) => m.AdminStaffPage),
      },
      {
        path: 'promo',
        canActivate: [adminPermissionGuard],
        data: { navKey: 'promo' satisfies NavKey },
        loadComponent: () => import('./features/promo/promo.page').then((m) => m.AdminPromoPage),
      },
      {
        path: 'gift-cards',
        canActivate: [adminPermissionGuard],
        data: { navKey: 'giftCards' satisfies NavKey },
        loadComponent: () => import('./features/gift-cards/gift-cards.page').then((m) => m.AdminGiftCardsPage),
      },
      {
        path: 'campaigns',
        canActivate: [adminPermissionGuard],
        data: { navKey: 'campaigns' satisfies NavKey },
        loadComponent: () => import('./features/campaigns/campaigns.page').then((m) => m.AdminCampaignsPage),
      },
      {
        path: 'analytics',
        canActivate: [adminPermissionGuard],
        data: { navKey: 'analytics' satisfies NavKey },
        loadComponent: () => import('./features/analytics/analytics.page').then((m) => m.AdminAnalyticsPage),
      },
      {
        path: 'brands',
        canActivate: [adminPermissionGuard],
        data: { navKey: 'brands' satisfies NavKey },
        loadComponent: () => import('./features/brands/brands.page').then((m) => m.AdminBrandsPage),
      },
      {
        path: 'settings',
        canActivate: [adminPermissionGuard],
        data: { navKey: 'settings' satisfies NavKey },
        loadComponent: () => import('./features/settings/settings.page').then((m) => m.AdminSettingsPage),
      },
      {
        path: 'integrations',
        canActivate: [adminPermissionGuard],
        data: { navKey: 'integrations' satisfies NavKey },
        loadComponent: () => import('./features/integrations/integrations.page').then((m) => m.AdminIntegrationsPage),
      },
      {
        path: 'telegram-link',
        canActivate: [adminPermissionGuard],
        data: { navKey: 'telegramLink' satisfies NavKey },
        loadComponent: () => import('./features/telegram-link/telegram-link.page').then((m) => m.TelegramLinkPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
