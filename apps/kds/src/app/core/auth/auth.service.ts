import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AuthSession, PasswordLoginRequest } from '@takeaway/shared-types';
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
}
