import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { TelegramNotifyLinkCode, TelegramNotifyStatus } from '@takeaway/shared-types';
import type { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/**
 * Where the signed-in account's work notifications go in Telegram — linked
 * through the bot, from the cabinet or the kitchen tablet alike.
 */
@Injectable({ providedIn: 'root' })
export class TelegramNotifyService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  private get url(): string {
    return `${this.api.baseUrl}/auth/telegram/notify-link`;
  }

  status(): Observable<TelegramNotifyStatus> {
    return this.http.get<TelegramNotifyStatus>(this.url);
  }

  /** A one-time `https://t.me/<bot>?start=link_<code>`, about ten minutes. */
  issue(): Observable<TelegramNotifyLinkCode> {
    return this.http.post<TelegramNotifyLinkCode>(this.url, {});
  }

  /** «Отвязать»: the bot stops writing. */
  unlink(): Observable<TelegramNotifyStatus> {
    return this.http.delete<TelegramNotifyStatus>(this.url);
  }
}
