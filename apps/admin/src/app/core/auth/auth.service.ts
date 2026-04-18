import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type {
  AuthSession,
  AuthTokens,
  AuthUser,
  SendOtpRequest,
  SendOtpResponse,
  VerifyOtpRequest,
} from '@takeaway/shared-types';
import { Observable, tap } from 'rxjs';

import { API_CONFIG } from '../api/api.config';
import { AuthStore } from './auth.store';

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly store = inject(AuthStore);
  private readonly api = inject(API_CONFIG);

  sendOtp(body: SendOtpRequest): Observable<SendOtpResponse> {
    return this.http.post<SendOtpResponse>(`${this.api.baseUrl}/auth/otp/send`, body);
  }

  verifyOtp(body: VerifyOtpRequest): Observable<AuthSession> {
    return this.http
      .post<AuthSession>(`${this.api.baseUrl}/auth/otp/verify`, { ...body, deviceType: 'WEB' })
      .pipe(tap((session) => this.store.set(session)));
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
