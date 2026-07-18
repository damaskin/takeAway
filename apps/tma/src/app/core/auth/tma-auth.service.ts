import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AuthSession } from '@takeaway/shared-types';
import { Observable, finalize, shareReplay, tap, throwError } from 'rxjs';

import { API_CONFIG } from '../api/api.config';
import { TelegramBridgeService } from '../telegram/telegram-bridge.service';
import { TmaAuthStore } from './tma-auth.store';

@Injectable({ providedIn: 'root' })
export class TmaAuthService {
  /** Path the interceptor must not re-authenticate on — that would recurse. */
  static readonly SIGN_IN_PATH = '/auth/telegram';

  private readonly http = inject(HttpClient);
  private readonly tg = inject(TelegramBridgeService);
  private readonly store = inject(TmaAuthStore);
  private readonly api = inject(API_CONFIG);

  private inFlight: Observable<AuthSession> | null = null;

  /**
   * Fire-and-forget sign-in on app start. We deliberately do NOT skip when a
   * stored session exists: access tokens live 15 minutes, so a hydrated
   * localStorage session is usually expired by the next launch. Trusting it
   * left the app sending a dead token — public catalog reads still worked, so
   * the menu rendered while POST /cart/items came back 401.
   */
  autoSignIn(): void {
    this.signIn().subscribe({ error: () => undefined });
  }

  /**
   * Exchanges Telegram initData for a fresh session. Concurrent callers share
   * one in-flight request so a burst of 401s can't stampede the endpoint.
   */
  signIn(): Observable<AuthSession> {
    const initData = this.tg.initData;
    if (!initData) return throwError(() => new Error('Telegram initData is unavailable'));
    if (this.inFlight) return this.inFlight;

    this.inFlight = this.http.post<AuthSession>(`${this.api.baseUrl}${TmaAuthService.SIGN_IN_PATH}`, { initData }).pipe(
      tap((session) => this.store.set(session)),
      finalize(() => {
        this.inFlight = null;
      }),
      shareReplay(1),
    );
    return this.inFlight;
  }
}
