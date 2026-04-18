import {
  HttpClient,
  HttpErrorResponse,
  type HttpEvent,
  type HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import type { AuthTokens } from '@takeaway/shared-types';
import { Observable, Subject, catchError, switchMap, throwError } from 'rxjs';

import { API_CONFIG } from '../api/api.config';
import { AuthStore } from './auth.store';

// Module-level state so concurrent requests share a single in-flight refresh
// instead of stampeding `/auth/refresh` and burning the rotated token N times.
// Pattern matches Angular's canonical "queue while refreshing" interceptor.
let refreshing = false;
let refreshNotifier: Subject<string | null> | null = null;

/**
 * Auth interceptor:
 *   - attaches `Authorization: Bearer <accessToken>` if the store has one
 *   - on 401 (for non-`/auth/*` requests), attempts a silent `/auth/refresh`,
 *     replays the original request with the new token, and only on refresh
 *     failure does it `clear()` the session.
 *
 * Without the refresh-and-retry layer a 15-minute access TTL turns every page
 * reload after lunch into a forced logout — the persisted refresh token
 * (7-day TTL) was being thrown away unused.
 */
export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(AuthStore);
  const http = inject(HttpClient);
  const api = inject(API_CONFIG);

  const token = store.accessToken();
  const authedReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authedReq).pipe(
    catchError((err: HttpErrorResponse) => {
      // Only handle 401s; only when we actually have a session to refresh; never
      // try to refresh the refresh call itself (would recurse).
      if (err.status !== 401) return throwError(() => err);
      if (!store.session()) return throwError(() => err);
      if (req.url.includes('/auth/refresh') || req.url.includes('/auth/otp/')) {
        store.clear();
        return throwError(() => err);
      }

      return runWithRefresh(http, api.baseUrl, store, req, next);
    }),
  );
};

function runWithRefresh(
  http: HttpClient,
  apiBase: string,
  store: AuthStore,
  originalReq: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  const replay = (newToken: string | null): Observable<HttpEvent<unknown>> => {
    if (!newToken) return throwError(() => new Error('refresh-failed'));
    const retried = originalReq.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } });
    return next(retried);
  };

  if (refreshing && refreshNotifier) {
    // Another request is already refreshing — queue up and replay when done.
    return refreshNotifier.pipe(switchMap(replay));
  }

  refreshing = true;
  refreshNotifier = new Subject<string | null>();
  const notifier = refreshNotifier;
  const refreshToken = store.refreshToken();

  if (!refreshToken) {
    refreshing = false;
    refreshNotifier = null;
    store.clear();
    return throwError(() => new Error('no-refresh-token'));
  }

  return http.post<AuthTokens>(`${apiBase}/auth/refresh`, { refreshToken }).pipe(
    switchMap((tokens) => {
      const ok = store.setTokens(tokens);
      refreshing = false;
      const newAccess = ok ? tokens.accessToken : null;
      notifier.next(newAccess);
      notifier.complete();
      refreshNotifier = null;
      return replay(newAccess);
    }),
    catchError((refreshErr) => {
      refreshing = false;
      notifier.next(null);
      notifier.complete();
      refreshNotifier = null;
      store.clear();
      return throwError(() => refreshErr);
    }),
  );
}
