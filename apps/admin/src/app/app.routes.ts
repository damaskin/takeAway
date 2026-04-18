import { Route } from '@angular/router';

import { anonymousGuard, authGuard } from './core/auth/auth.guard';

export const appRoutes: Route[] = [
  {
    path: 'login',
    canMatch: [anonymousGuard],
    loadComponent: () => import('./features/login/login.page').then((m) => m.LoginPage),
  },
  {
    path: '',
    canMatch: [authGuard],
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
        path: 'promo',
        loadComponent: () => import('./features/promo/promo.page').then((m) => m.AdminPromoPage),
      },
      {
        path: 'analytics',
        loadComponent: () => import('./features/analytics/analytics.page').then((m) => m.AdminAnalyticsPage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
