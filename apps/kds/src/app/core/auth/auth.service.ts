import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AuthSession } from '@takeaway/shared-types';
import { Observable, tap } from 'rxjs';

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
}
