import { Route } from '@angular/router';

import { authGuard } from './core/auth/auth.guard';

export const appRoutes: Route[] = [
  {
    path: '',
    loadComponent: () => import('./features/layout/web-layout.page').then((m) => m.WebLayoutPage),
    children: [
      { path: '', pathMatch: 'full', loadComponent: () => import('./features/home/home.page').then((m) => m.HomePage) },
      {
        path: 'login',
        loadComponent: () => import('./features/login/login.page').then((m) => m.LoginPage),
      },
      {
        path: 'stores',
        loadComponent: () => import('./features/stores/stores-list.page').then((m) => m.StoresListPage),
      },
      {
        path: 'stores/:slug',
        loadComponent: () => import('./features/menu/menu.page').then((m) => m.MenuPage),
      },
      {
        path: 'menu',
        loadComponent: () => import('./features/menu/menu.page').then((m) => m.MenuPage),
      },
      {
        path: 'products/:slug',
        loadComponent: () => import('./features/product/product.page').then((m) => m.ProductPage),
      },
      {
        path: 'checkout',
        canMatch: [authGuard],
        loadComponent: () => import('./features/checkout/checkout.page').then((m) => m.CheckoutPage),
      },
      {
        path: 'orders',
        canMatch: [authGuard],
        loadComponent: () => import('./features/orders/orders-history.page').then((m) => m.OrdersHistoryPage),
      },
      {
        path: 'orders/:id',
        canMatch: [authGuard],
        loadComponent: () => import('./features/order-status/order-status.page').then((m) => m.OrderStatusPage),
      },
      {
        path: 'profile',
        canMatch: [authGuard],
        loadComponent: () => import('./features/profile/profile.page').then((m) => m.ProfilePage),
      },
    ],
  },
  { path: '**', redirectTo: '' },
];
