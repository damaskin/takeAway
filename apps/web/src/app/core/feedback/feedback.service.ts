import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { CreateFeedbackRequest, FeedbackReceipt, SiteSupportRequest } from '@takeaway/shared-types';
import type { Observable } from 'rxjs';

import { API_CONFIG } from '../api/api.config';

/**
 * «Обратная связь» — a signed-in customer's review, suggestion or problem
 * report — and the «Поддержка» page's form, open to everyone.
 */
@Injectable({ providedIn: 'root' })
export class FeedbackService {
  private readonly http = inject(HttpClient);
  private readonly api = inject(API_CONFIG);

  /** 429 with `code: FEEDBACK_TOO_MANY` past five messages an hour. */
  send(body: CreateFeedbackRequest): Observable<FeedbackReceipt> {
    return this.http.post<FeedbackReceipt>(`${this.api.baseUrl}/feedback`, body);
  }

  /**
   * The «Поддержка» form. A visitor must leave an email or a phone
   * (`SUPPORT_CONTACT_REQUIRED`); a signed-in customer's message goes under
   * their account. 429 past a few messages an hour from one address or
   * contact.
   */
  sendSupport(body: SiteSupportRequest): Observable<void> {
    return this.http.post<void>(`${this.api.baseUrl}/feedback/support`, body);
  }
}
