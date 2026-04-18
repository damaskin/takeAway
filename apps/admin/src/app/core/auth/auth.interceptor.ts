import {
  HttpClient,
  HttpErrorResponse,
  type HttpEvent,
  type HttpHandlerFn,
  HttpInterceptorFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import type { AuthTokens } from '@takeaway/shared-types';
import { Observable, Subject, catchError, switchMap, throwError } from 'rxjs';

import { API_CONFIG } from '../api/api.config';
import { AuthStore } from './auth.store';

// Module-level state so concurrent requests share a single in-flight refresh
// instead of stampeding `/auth/refresh`. Identical pattern to web/kds.
let refreshing = false;
let refreshNotifier: Subject<string | null> | null = null;

export const authInterceptor: HttpInterceptorFn = (req, next) => {
  const store = inject(AuthStore);
  const router = inject(Router);
  const http = inject(HttpClient);
  const api = inject(API_CONFIG);

  const token = store.accessToken();
  const authedReq = token ? req.clone({ setHeaders: { Authorization: `Bearer ${token}` } }) : req;

  return next(authedReq).pipe(
    catchError((err: HttpErrorResponse) => {
      if (err.status !== 401) return throwError(() => err);
      if (!store.session()) return throwError(() => err);
      if (req.url.includes('/auth/refresh') || req.url.includes('/auth/otp/')) {
        store.clear();
        void router.navigate(['/login']);
        return throwError(() => err);
      }

      return runWithRefresh(http, api.baseUrl, store, router, req, next);
    }),
  );
};

function runWithRefresh(
  http: HttpClient,
  apiBase: string,
  store: AuthStore,
  router: Router,
  originalReq: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  const replay = (newToken: string | null): Observable<HttpEvent<unknown>> => {
    if (!newToken) return throwError(() => new Error('refresh-failed'));
    const retried = originalReq.clone({ setHeaders: { Authorization: `Bearer ${newToken}` } });
    return next(retried);
  };

  if (refreshing && refreshNotifier) {
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
    void router.navigate(['/login']);
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
      void router.navigate(['/login']);
      return throwError(() => refreshErr);
    }),
  );
}
