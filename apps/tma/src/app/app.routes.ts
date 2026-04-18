import { Route } from '@angular/router';

export const appRoutes: Route[] = [
  { path: '', loadComponent: () => import('./features/home/home.page').then((m) => m.TmaHomePage) },
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
    path: 'orders/:id',
    loadComponent: () => import('./features/order-status/order-status.page').then((m) => m.TmaOrderStatusPage),
  },
  { path: '**', redirectTo: '' },
];
