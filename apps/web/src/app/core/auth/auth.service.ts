import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AuthSession, AuthTokens, AuthUser, LinkSignInMethodResult, SignInMethods } from '@takeaway/shared-types';
import { map, Observable, tap } from 'rxjs';

import { API_CONFIG } from '../api/api.config';
import { AuthStore } from './auth.store';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(AuthStore);
  private readonly api = inject(API_CONFIG);

  /**
   * Sign in via the Telegram Login Widget
   * (https://core.telegram.org/widgets/login). The payload is forwarded
   * verbatim; the server re-verifies the `hash` against the bot token.
   */
  verifyTelegramWidget(payload: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    photo_url?: string;
    auth_date: number;
    hash: string;
  }): Observable<AuthSession> {
    return this.http
      .post<AuthSession>(`${this.api.baseUrl}/auth/telegram/widget`, payload)
      .pipe(tap((session) => this.store.set(session)));
  }

  /**
   * Sign in with Telegram Login (OpenID Connect). `idToken` comes from
   * Telegram's popup; the server verifies it against Telegram's keys.
   */
  signInWithTelegramIdToken(idToken: string): Observable<AuthSession> {
    return this.http
      .post<AuthSession>(`${this.api.baseUrl}/auth/telegram/oidc`, { idToken })
      .pipe(tap((session) => this.store.set(session)));
  }

  /**
   * Sign in with Google. `idToken` is the `credential` handed back by
   * Google Identity Services; the server re-verifies it against Google's
   * JWKS before trusting a claim.
   */
  signInWithGoogle(idToken: string): Observable<AuthSession> {
    return this.http
      .post<AuthSession>(`${this.api.baseUrl}/auth/google`, { idToken })
      .pipe(tap((session) => this.store.set(session)));
  }

  /**
   * Sign in with Apple. `name` is only ever present on the customer's very
   * first consent — Apple never sends it again, so it has to travel with
   * this one call or the account stays nameless.
   */
  signInWithApple(idToken: string, name?: string): Observable<AuthSession> {
    return this.http
      .post<AuthSession>(`${this.api.baseUrl}/auth/apple`, name ? { idToken, name } : { idToken })
      .pipe(tap((session) => this.store.set(session)));
  }

  /** Which of Telegram, Google and Apple lead into the signed-in profile. */
  signInMethods(): Observable<SignInMethods> {
    return this.http.get<SignInMethods>(`${this.api.baseUrl}/auth/me/sign-in-methods`);
  }

  /**
   * Add a sign-in method to the signed-in profile. When it already led into
   * a profile with orders and this one had none, the API moves the customer
   * there and returns its session, which replaces ours.
   */
  linkSignInMethod(
    provider: 'google' | 'apple' | 'telegram',
    body: { idToken: string; name?: string },
  ): Observable<{ methods: SignInMethods; switched: boolean }> {
    return this.http.post<LinkSignInMethodResult>(`${this.api.baseUrl}/auth/me/sign-in-methods/${provider}`, body).pipe(
      tap((result) => {
        if (result.session) this.store.set(result.session);
      }),
      map((result) => ({ methods: result.methods, switched: Boolean(result.session) })),
    );
  }

  unlinkSignInMethod(provider: 'google' | 'apple'): Observable<SignInMethods> {
    return this.http.delete<SignInMethods>(`${this.api.baseUrl}/auth/me/sign-in-methods/${provider}`);
  }

  refresh(refreshToken: string): Observable<AuthTokens> {
    return this.http.post<AuthTokens>(`${this.api.baseUrl}/auth/refresh`, { refreshToken });
  }

  me(): Observable<AuthUser> {
    return this.http.get<AuthUser>(`${this.api.baseUrl}/auth/me`);
  }

  updateMe(patch: {
    name?: string;
    phone?: string;
    email?: string;
    dateOfBirth?: string;
    locale?: 'EN' | 'RU';
    currency?: 'USD' | 'EUR' | 'GBP' | 'AED' | 'THB' | 'IDR' | 'MDL' | 'RUP';
  }): Observable<AuthUser> {
    return this.http.patch<AuthUser>(`${this.api.baseUrl}/auth/me`, patch).pipe(
      tap((user) => {
        const session = this.store.session();
        if (session) this.store.set({ ...session, user });
      }),
    );
  }

  logout(): Observable<void> {
    const session = this.store.session();
    this.store.clear();
    if (!session) return new Observable((sub) => sub.complete());
    return this.http.post<void>(`${this.api.baseUrl}/auth/logout`, { refreshToken: session.refreshToken });
  }
}
