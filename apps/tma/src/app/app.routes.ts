import { Route } from '@angular/router';

import { tmaSessionGuard } from './core/auth/tma-session.guard';
import { startParamGuard } from './core/telegram/start-param.guard';

/**
 * Every route carries {@link tmaSessionGuard}. It never blocks navigation —
 * it just gives the Telegram sign-in another attempt if the one at startup
 * could not reach the API. {@link startParamGuard} sends the first screen to
 * the order a launch link (`startapp=order_<id>`) points at.
 */
export const appRoutes: Route[] = [
  {
    path: '',
    canActivate: [tmaSessionGuard, startParamGuard],
    children: [
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
        path: 'cards',
        loadComponent: () => import('./features/payment-cards/payment-cards.page').then((m) => m.TmaPaymentCardsPage),
      },
      {
        path: 'profile',
        loadComponent: () => import('./features/profile/profile.page').then((m) => m.TmaProfilePage),
      },
      {
        path: 'feedback',
        loadComponent: () => import('./features/feedback/feedback.page').then((m) => m.TmaFeedbackPage),
      },
      { path: '**', redirectTo: '' },
    ],
  },
];
