import { HttpErrorResponse, HttpInterceptorFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { catchError, switchMap, throwError } from 'rxjs';

import { TmaAuthService } from './tma-auth.service';
import { TmaAuthStore } from './tma-auth.store';

/**
 * Attaches the bearer token and, on a 401, quietly rebuilds the session and
 * replays the request.
 *
 * The Mini App has no login screen to fall back to, so a 401 must never
 * reach the customer as one. Telegram's `initData` stays valid for the life
 * of the web view, which means an expired access token is always
 * recoverable without asking them anything — a checkout tapped twenty
 * minutes after opening the bot just works.
 */
export const tmaAuthInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(TmaAuthStore);
  const auth = inject(TmaAuthService);

  return next(withToken(req, store.accessToken())).pipe(
    catchError((err: unknown) => {
      if (!(err instanceof HttpErrorResponse) || err.status !== 401) return throwError(() => err);
      // Never recurse through the endpoints that mint tokens.
      if (req.url.includes(TmaAuthService.SIGN_IN_PATH) || req.url.includes(TmaAuthService.REFRESH_PATH)) {
        return throwError(() => err);
      }

      return auth
        .recoverSession()
        .pipe(switchMap((token) => (token ? next(withToken(req, token)) : throwError(() => err))));
    }),
  );
};

function withToken(req: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  return token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;
}
