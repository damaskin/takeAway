import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';

import { TmaAuthService } from './tma-auth.service';
import { TmaAuthStore } from './tma-auth.store';

export const tmaAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(TmaAuthStore);
  const auth = inject(TmaAuthService);

  const withToken = (r: HttpRequest<unknown>): HttpRequest<unknown> => {
    const token = store.accessToken();
    return token ? r.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : r;
  };

  // The sign-in call carries no bearer and must never trigger a re-auth loop.
  if (req.url.includes(TmaAuthService.SIGN_IN_PATH)) return next(req);

  return next(withToken(req)).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) return throwError(() => err);
      // A Mini App can stay open far longer than the 15-minute access token.
      // initData is always available inside Telegram, so mint a fresh session
      // and replay the request once rather than failing the user's tap.
      return auth.signIn().pipe(switchMap(() => next(withToken(req))));
    }),
  );
};
