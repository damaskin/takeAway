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

interface TelegramLoginPayload {
  id: number;
  first_name: string;
  last_name?: string;
  username?: string;
  photo_url?: string;
  auth_date: number;
  hash: string;
}

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

  changePassword(body: { currentPassword: string; newPassword: string }): Observable<void> {
    return this.http
      .post<void>(`${this.api.baseUrl}/auth/password/change`, body)
      .pipe(tap(() => this.store.clearMustChangePassword()));
  }

  linkTelegram(payload: TelegramLoginPayload): Observable<AuthUser> {
    return this.http.post<AuthUser>(`${this.api.baseUrl}/auth/telegram/link`, payload).pipe(
      tap((user) => {
        const session = this.store.session();
        if (session) this.store.set({ ...session, user });
      }),
    );
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
