import { inject } from '@angular/core';
import { CanMatchFn, Router, UrlTree } from '@angular/router';

import { AuthStore } from './auth.store';

export const authGuard: CanMatchFn = (): boolean | UrlTree => {
  const store = inject(AuthStore);
  const router = inject(Router);
  if (!store.isAuthenticated()) {
    return router.parseUrl('/login');
  }
  const role = store.user()?.role;
  const kdsRoles = ['SUPER_ADMIN', 'BRAND_ADMIN', 'STORE_MANAGER', 'STAFF'];
  if (!role || !kdsRoles.includes(role)) {
    return router.parseUrl('/login?forbidden=1');
  }
  return true;
};

export const anonymousGuard: CanMatchFn = (): boolean | UrlTree => {
  const store = inject(AuthStore);
  const router = inject(Router);
  return store.isAuthenticated() ? router.parseUrl('/') : true;
};
