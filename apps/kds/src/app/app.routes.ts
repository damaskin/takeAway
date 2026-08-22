import { Route } from '@angular/router';

import { anonymousGuard, authGuard } from './core/auth/auth.guard';

export const appRoutes: Route[] = [
  // PIN is the default way in: the tablet lives on the pass, and a work
  // email plus an eight-character password is both slow to type there and
  // visible to the queue. Managers can still fall back to the password
  // form one link away.
  {
    path: 'login',
    canMatch: [anonymousGuard],
    loadComponent: () => import('./features/login/pin.page').then((m) => m.KdsPinPage),
  },
  {
    path: 'login/password',
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
