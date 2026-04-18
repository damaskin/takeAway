import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { AuthSession } from '@takeaway/shared-types';

import { API_CONFIG } from '../api/api.config';
import { TelegramBridgeService } from '../telegram/telegram-bridge.service';
import { TmaAuthStore } from './tma-auth.store';

@Injectable({ providedIn: 'root' })
export class TmaAuthService {
  private readonly http = inject(HttpClient);
  private readonly tg = inject(TelegramBridgeService);
  private readonly store = inject(TmaAuthStore);
  private readonly api = inject(API_CONFIG);

  autoSignIn(): void {
    if (this.store.isAuthenticated()) return;
    const initData = this.tg.initData;
    if (!initData) return;

    this.http.post<AuthSession>(`${this.api.baseUrl}/auth/telegram`, { initData }).subscribe({
      next: (session) => this.store.set(session),
      error: () => {
        /* stay unauthenticated; catalog is public */
      },
    });
  }
}
