import { inject } from '@angular/core';
import { CanMatchFn, Router, UrlTree } from '@angular/router';

import { AuthStore } from './auth.store';

export const authGuard: CanMatchFn = (): boolean | UrlTree => {
  const store = inject(AuthStore);
  const router = inject(Router);
  if (!store.isAuthenticated()) {
    return router.parseUrl('/login');
  }
  return true;
};
