import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  { path: '', loadComponent: () => import('./features/home/home.page').then((m) => m.TmaHomePage) },
  {
    path: 'stores',
    loadComponent: () => import('./features/stores/stores.page').then((m) => m.TmaStoresPage),
  },
  {
    path: 'stores/:slug',
    loadComponent: () => import('./features/menu/menu.page').then((m) => m.TmaMenuPage),
  },
  {
    path: 'products/:slug',
    loadComponent: () => import('./features/product/product.page').then((m) => m.TmaProductPage),
  },
  {
    path: 'checkout',
    loadComponent: () => import('./features/checkout/checkout.page').then((m) => m.TmaCheckoutPage),
  },
  {
    path: 'orders',
    loadComponent: () => import('./features/orders/orders.page').then((m) => m.TmaOrdersPage),
  },
  {
    path: 'orders/:id',
    loadComponent: () => import('./features/order-status/order-status.page').then((m) => m.TmaOrderStatusPage),
  },
  {
    path: 'profile',
    loadComponent: () => import('./features/profile/profile.page').then((m) => m.TmaProfilePage),
  },
  { path: '**', redirectTo: '' },
];
