import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AuthSession, SendOtpRequest, SendOtpResponse, VerifyOtpRequest } from '@takeaway/shared-types';
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
}
