import { inject } from '@angular/core';
import { Route, Router } from '@angular/router';

import { anonymousGuard, authGuard } from './core/auth/auth.guard';
import { AuthStore } from './core/auth/auth.store';
import { FeatureFlagsStore } from './core/config/feature-flags.store';

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

export const appRoutes: Route[] = [
  {
    path: 'login',
    canMatch: [anonymousGuard],
    loadComponent: () => import('./features/login/login.page').then((m) => m.LoginPage),
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
    path: 'rider',
    canMatch: [authGuard],
    canActivate: [deliveryEnabledGuard],
    loadComponent: () => import('./features/rider/rider.page').then((m) => m.RiderPage),
  },
  {
    path: '',
    canMatch: [authGuard],
    canActivate: [redirectRiderToRiderHome],
    loadComponent: () => import('./features/layout/admin-layout.page').then((m) => m.AdminLayoutPage),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'dashboard' },
      {
        path: 'dashboard',
        loadComponent: () => import('./features/dashboard/dashboard.page').then((m) => m.DashboardPage),
      },
      {
        path: 'menu',
        loadComponent: () => import('./features/menu/menu.page').then((m) => m.MenuPage),
      },
      {
        path: 'stores',
        loadComponent: () => import('./features/stores/stores.page').then((m) => m.StoresPage),
      },
      {
        path: 'orders',
        loadComponent: () => import('./features/orders/orders.page').then((m) => m.AdminOrdersPage),
      },
      {
        path: 'dispatch',
        canActivate: [deliveryEnabledGuard],
        loadComponent: () => import('./features/dispatch/dispatch.page').then((m) => m.DispatchPage),
      },
      {
        path: 'riders',
        loadComponent: () => import('./features/riders/riders.page').then((m) => m.AdminRidersPage),
      },
      {
        path: 'staff',
        loadComponent: () => import('./features/staff/staff.page').then((m) => m.AdminStaffPage),
      },
      {
        path: 'promo',
        loadComponent: () => import('./features/promo/promo.page').then((m) => m.AdminPromoPage),
      },
      {
        path: 'analytics',
        loadComponent: () => import('./features/analytics/analytics.page').then((m) => m.AdminAnalyticsPage),
      },
      {
        path: 'brands',
        loadComponent: () => import('./features/brands/brands.page').then((m) => m.AdminBrandsPage),
      },
      {
        path: 'settings',
        loadComponent: () => import('./features/settings/settings.page').then((m) => m.AdminSettingsPage),
      },
      {
        path: 'telegram-link',
        loadComponent: () => import('./features/telegram-link/telegram-link.page').then((m) => m.TelegramLinkPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
