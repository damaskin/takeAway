import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AuthSession, AuthTokens } from '@takeaway/shared-types';
import { Observable, catchError, finalize, map, of, retry, shareReplay, switchMap, throwError, timer } from 'rxjs';
import { timeout } from 'rxjs/operators';

import { API_CONFIG } from '../api/api.config';
import { TelegramBridgeService } from '../telegram/telegram-bridge.service';
import { TmaAuthStore } from './tma-auth.store';

/** Attempts after the first, for blips only — a 4xx is never retried. */
const SIGN_IN_RETRIES = 2;
const RETRY_BASE_MS = 400;
/**
 * Hard ceiling across every attempt. The bootstrap waits on this, so it
 * doubles as the longest we are willing to hold the Telegram splash screen
 * before letting the customer into the catalogue unauthenticated.
 */
const SIGN_IN_TIMEOUT_MS = 8_000;

/**
 * Authentication for the Mini App — which, by design, has no sign-in screen
 * at all.
 *
 * Telegram already knows who the customer is: it hands the web view a
 * signed `initData` blob at launch. We trade that for a session before the
 * first screen renders, so from the customer's side there is no login step,
 * no button, no redirect — they open the bot and their cart is already
 * theirs.
 *
 * Everything here is therefore silent and self-healing. Nothing in this
 * service ever asks the customer for anything; when a session lapses we
 * rebuild it from the same `initData` and replay the request.
 */
@Injectable({ providedIn: 'root' })
export class TmaAuthService {
  private readonly http = inject(HttpClient);
  private readonly tg = inject(TelegramBridgeService);
  private readonly store = inject(TmaAuthStore);
  private readonly api = inject(API_CONFIG);

  /** Shared so a burst of callers produces one request, not one each. */
  private pending: Observable<boolean> | null = null;

  /** True when we are running inside Telegram and can authenticate at all. */
  get canAuthenticate(): boolean {
    return this.tg.initData !== null;
  }

  /**
   * Guarantee a session if one is obtainable. Cheap and idempotent — safe to
   * call from the bootstrap, a guard, or a retry path.
   *
   * Resolves `false` rather than throwing when we are outside Telegram or
   * the API is unreachable: the catalogue is public, so browsing still
   * works and only checkout needs to complain.
   */
  ensureSession(): Observable<boolean> {
    if (this.store.isAuthenticated()) return of(true);
    return this.signInWithInitData();
  }

  /**
   * Recover from a 401 without involving the customer: rotate the refresh
   * token if we have one, otherwise mint a whole new session from
   * `initData`. Resolves the access token to replay with, or null if the
   * request should be allowed to fail.
   */
  recoverSession(): Observable<string | null> {
    const refreshToken = this.store.refreshToken();
    if (!refreshToken) {
      return this.signInWithInitData().pipe(map((ok) => (ok ? this.store.accessToken() : null)));
    }

    return this.http.post<AuthTokens>(`${this.api.baseUrl}/auth/refresh`, { refreshToken }).pipe(
      map((tokens) => (this.store.setTokens(tokens) ? tokens.accessToken : null)),
      catchError(() => {
        // The refresh token is gone or revoked. In a browser this would be a
        // logout; in the Mini App we still hold Telegram's own proof of
        // identity, so start over instead of showing the customer a wall.
        this.store.clear();
        return this.signInWithInitData().pipe(map((ok) => (ok ? this.store.accessToken() : null)));
      }),
    );
  }

  private signInWithInitData(): Observable<boolean> {
    if (this.pending) return this.pending;

    const initData = this.tg.initData;
    if (!initData) return of(false);

    this.pending = this.http.post<AuthSession>(`${this.api.baseUrl}/auth/telegram`, { initData }).pipe(
      retry({
        count: SIGN_IN_RETRIES,
        delay: (err, attempt) => {
          const status = err instanceof HttpErrorResponse ? err.status : 0;
          // 0 is a dropped connection — Telegram's web view does that when
          // the app is backgrounded mid-launch, and it is worth another go.
          // 5xx is our side. Anything else is a verdict, not a blip.
          if (status !== 0 && status < 500) return throwError(() => err);
          return timer(RETRY_BASE_MS * 2 ** (attempt - 1));
        },
      }),
      timeout(SIGN_IN_TIMEOUT_MS),
      map((session) => {
        this.store.set(session);
        return true;
      }),
      catchError(() => of(false)),
      finalize(() => {
        this.pending = null;
      }),
      shareReplay({ bufferSize: 1, refCount: false }),
    );

    return this.pending;
  }
}

/**
 * Bootstrap hook: hold the app until the session lands, so the first screen
 * never fires an authenticated request without a token. Bounded by
 * {@link SIGN_IN_TIMEOUT_MS} — a broken API delays the launch, it does not
 * hang it.
 */
export function initialiseTmaSession(): Observable<unknown> {
  const tg = inject(TelegramBridgeService);
  const auth = inject(TmaAuthService);
  return auth.ensureSession().pipe(
    switchMap((ok) => {
      tg.ready();
      tg.expand();
      return of(ok);
    }),
  );
}
