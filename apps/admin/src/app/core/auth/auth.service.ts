import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AuthSession,
  AuthTokens,
  AuthUser,
  PasswordForgotRequest,
  PasswordLoginRequest,
  PasswordResetRequest,
} from '@takeaway/shared-types';
import { Observable, tap } from 'rxjs';

import { API_CONFIG } from '../api/api.config';
import { AuthStore } from './auth.store';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(AuthStore);
  private readonly api = inject(API_CONFIG);

  login(body: PasswordLoginRequest): Observable<AuthSession> {
    return this.http
      .post<AuthSession>(`${this.api.baseUrl}/auth/password/login`, body)
      .pipe(tap((session) => this.store.set(session)));
  }

  forgotPassword(body: PasswordForgotRequest): Observable<void> {
    return this.http.post<void>(`${this.api.baseUrl}/auth/password/forgot`, body);
  }

  resetPassword(body: PasswordResetRequest): Observable<void> {
    return this.http.post<void>(`${this.api.baseUrl}/auth/password/reset`, body);
  }

  refresh(refreshToken: string): Observable<AuthTokens> {
    return this.http.post<AuthTokens>(`${this.api.baseUrl}/auth/refresh`, { refreshToken });
  }

  me(): Observable<AuthUser> {
    return this.http.get<AuthUser>(`${this.api.baseUrl}/auth/me`);
  }

  logout(): Observable<void> {
    const session = this.store.session();
    this.store.clear();
    if (!session) return new Observable((sub) => sub.complete());
    return this.http.post<void>(`${this.api.baseUrl}/auth/logout`, { refreshToken: session.refreshToken });
  }
}
