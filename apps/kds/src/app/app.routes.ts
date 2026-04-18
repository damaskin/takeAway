import { Route } from '@angular/router';

import { anonymousGuard, authGuard } from './core/auth/auth.guard';

export const appRoutes: Route[] = [
  {
    path: 'login',
    canMatch: [anonymousGuard],
    loadComponent: () => import('./features/login/login.page').then((m) => m.KdsLoginPage),
  },
  {
    path: '',
    canMatch: [authGuard],
    loadComponent: () => import('./features/board/board.page').then((m) => m.KdsBoardPage),
  },
  { path: '**', redirectTo: '' },
];
