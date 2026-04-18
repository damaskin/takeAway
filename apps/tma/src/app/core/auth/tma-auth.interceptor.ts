import { HttpInterceptorFn } from '@angular/common/http';
import { inject } from '@angular/core';

import { TmaAuthStore } from './tma-auth.store';

export const tmaAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const token = inject(TmaAuthStore).accessToken();
  const authed = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
  return next(authed);
};
